// Import ordini Tyre24 "Anonimo" (ordini guest, Fase 9) — port 1:1 della
// Cloud Function `processT24Orders`/`processT24OrdersManual` (crm-3iuocs,
// europe-west1), sorgente reale riscaricato da GCP. Stessa logica: pull API
// REST Alzura → scrittura ordini/clienti direttamente su Postgres
// (core.ordini/ordine_articoli/clienti). Il bridge esistente (Fase 4)
// propaga automaticamente ogni riga verso Firestore per il CRM Flutter
// legacy — nessuna scrittura Firestore diretta da questo importer.
//
// Logica di dominio (customer/articoli/indirizzi/pagamento/documenti)
// condivisa con tyre24Regular.js via tyre24Shared.js — le due Cloud Function
// originali erano byte-per-byte identiche su questa parte, differendo solo
// per fonte dati (API diretta vs FTP) e token Alzura.
//
// Differenze dal sorgente CF originale:
//  - Scrittura diretta su Postgres invece che Firestore (cutover Fase 9,
//    deciso dopo aver verificato che il polling GCP originale — counter=0
//    fisso su /common/latestorders — perde ordini assegnati ad altri counter;
//    passare da Postgres-first non risolve quel bug ma centralizza il dato).
//  - Idempotenza via PRIMARY KEY + `ON CONFLICT DO NOTHING` (core.ordini.id),
//    equivalente esatto del `.create()` usato nella versione Firestore-diretta.
//  - Token Alzura spostato da hardcoded nel sorgente a env var `T24_ANON_TOKEN`
//    (stesso nome già atteso da lib/marketplace/sdk.js, mai popolato finora).
//  - Modalità `dryRun`: verifica solo quali ordini risultano nuovi (via
//    l'existence-check su Postgres), senza risolvere cliente/articoli/
//    indirizzi né scrivere — quella risoluzione comporta scritture non
//    deterministiche (ID cliente auto-generati) che non si possono simulare
//    senza eseguirle davvero.

import { isAlreadyExists } from "./util";
import {
  STATUS_MAPPING,
  processExtraExpenses,
  processPayment,
  processDocuments,
  notifyTyre24OrderReceived as notify,
} from "./tyre24Shared";
import { resolveCustomerPg, resolveArticlesPg, buildAddressSnapshots, insertOrderPg, orderExistsPg } from "./tyre24PgWrite";
import { getDb } from "../db";
import { adminDb } from "../firebase-admin";

const ALZURA_URL = "https://api-b2b.alzura.com/common/latestorders?counter=0&demo=0&no_tagging=1&order_role=SELLER&tracking_number=0";
const ALZURA_COUNTRY = "de";
const SOURCE = "Anonimo";

function authToken() {
  const token = process.env.T24_ANON_TOKEN;
  if (!token) throw new Error("Missing T24_ANON_TOKEN");
  return token;
}

async function fetchOrdersFromAPI() {
  const response = await fetch(ALZURA_URL, {
    headers: {
      "X-AUTH-TOKEN": authToken(),
      Accept: "application/vnd.saitowag.api+json;version=1.2",
      country: ALZURA_COUNTRY,
    },
  });
  if (!response.ok) throw new Error(`Alzura API error: ${response.status} ${response.statusText}`);
  const data = await response.json();
  return data.data || [];
}

/* ── single order processing ─────────────────────────────────────── */

// Esportata per il recupero manuale di ordini T24 mancati (Fase 9) — stesso
// motivo di processIndividualOrder in tyre24Regular.js: esercita la logica
// reale su un payload ordine ottenuto direttamente da GET /common/order/{id},
// senza passare da /common/latestorders (che può non includere l'ordine,
// vedi Fase 9 del piano — bug di paginazione per counter).
export async function processOrder(order, dryRun) {
  // Fast-path: se già esiste, evitiamo di risolvere cliente/articoli/indirizzi
  // per niente. La race residua (creato tra questo check e l'INSERT sotto) è
  // chiusa dal PRIMARY KEY + ON CONFLICT più avanti, non da questo check.
  const alreadyExists = await orderExistsPg(order.order);
  if (alreadyExists) return { orderDocId: order.order, skipped: true };

  if (dryRun) return { orderDocId: order.order, skipped: false };

  const deliveryCountry = order.shipping.delivery_address.use_alternative_address
    ? order.shipping.delivery_address.address.country
    : order.buyer.address.country;
  const isItaly = deliveryCountry?.toLowerCase().includes("ital") || false;

  let result;
  try {
    // NB: resolveCustomerPg/resolveArticlesPg aprono le proprie query mono-uso
    // (non nella stessa transazione dell'INSERT ordine) — accettabile: sono
    // letture/creazioni idempotenti (lookup su partita_iva, SKU lookup
    // read-only), la vera atomicità che conta (ordine+articoli insieme o
    // niente) è garantita dentro insertOrderPg.
    const pool = getDb();
    if (!pool) throw new Error("DATABASE_URL non configurata");
    const readClient = await pool.connect();
    let clienteId, articoli;
    try {
      clienteId = await resolveCustomerPg(readClient, order.buyer, SOURCE);
      articoli = await resolveArticlesPg(adminDb(), order.positions, isItaly);
    } finally {
      readClient.release();
    }

    const totalePFUReal = isItaly ? articoli.reduce((sum, art) => sum + (art.pfu * art.quantita || 0), 0) : 0;
    const totaleIVA = isItaly ? order.total_sum.gross_converted - order.total_sum.net_converted : 0;
    const totale = isItaly ? order.total_sum.gross_converted : order.total_sum.net_converted;

    const { indirizzoFatturazione, indirizzoSpedizione } = buildAddressSnapshots(order);
    const pagamento = processPayment(order.payment, isItaly);
    const documenti = processDocuments(order.documents);
    const speseExtra = processExtraExpenses(order, isItaly);
    const stato = STATUS_MAPPING[order.status.toString()] || "Unknown";

    result = await insertOrderPg(
      order.order,
      {
        source: SOURCE,
        stato,
        clienteId,
        totale,
        iva: totaleIVA,
        pfu: totalePFUReal,
        pagamento,
        indirizzoFatturazione,
        indirizzoSpedizione,
        note: order.comment || "",
        t24Country: order.country || "",
        dataOra: new Date(order.date),
        createdAt: new Date(),
        fsExtra: { IsItaly: isItaly, Documenti: documenti, Spese_Extra: speseExtra },
      },
      articoli
    );
  } catch (err) {
    if (isAlreadyExists(err)) return { orderDocId: order.order, skipped: true };
    throw err;
  }

  if (result.skipped) return { orderDocId: order.order, skipped: true };

  await notify(order.order, order.country, authToken(), ALZURA_COUNTRY);
  return { orderDocId: order.order, skipped: false };
}

/* ── entry point ──────────────────────────────────────────────────── */

/**
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function runTyre24AnonimoImport(opts = {}) {
  const { dryRun = false } = opts;
  const result = { processedCount: 0, newCount: 0, updatedCount: 0, skippedCount: 0, errors: [] };

  const orders = await fetchOrdersFromAPI();
  for (const order of orders) {
    try {
      const { skipped } = await processOrder(order, dryRun);
      result.processedCount++;
      if (skipped) result.skippedCount++;
      else result.newCount++;
    } catch (err) {
      result.errors.push({ id: order.order, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
