// Import ordini Tyre24 "Anonimo" (ordini guest, Fase 9) — port 1:1 della
// Cloud Function `processT24Orders`/`processT24OrdersManual` (crm-3iuocs,
// europe-west1), sorgente reale riscaricato da GCP. Stessa logica: pull API
// REST Alzura → scrittura Ordini/Clienti su Firestore via Admin SDK. Il
// bridge esistente sincronizza su Postgres, nessuna modifica.
//
// Logica di dominio (customer/articoli/indirizzi/pagamento/documenti)
// condivisa con tyre24Regular.js via tyre24Shared.js — le due Cloud Function
// originali erano byte-per-byte identiche su questa parte, differendo solo
// per fonte dati (API diretta vs FTP) e token Alzura.
//
// Differenze dal sorgente CF originale:
//  - `Ordini.doc(id).create()` invece di `.get()`+`.set()` per la scrittura
//    finale — chiude la finestra TOCTOU dell'idempotenza. Il check `.get()`
//    iniziale resta (evita di costruire l'intero ordine per niente quando è
//    già presente), ma non è più l'unica difesa contro i duplicati.
//  - Token Alzura spostato da hardcoded nel sorgente a env var `T24_ANON_TOKEN`
//    (stesso nome già atteso da lib/marketplace/sdk.js, mai popolato finora).
//  - Modalità `dryRun`: verifica solo quali ordini risultano nuovi (via
//    l'existence-check), senza risolvere cliente/articoli/indirizzi né
//    scrivere — quella risoluzione comporta scritture non deterministiche
//    (ID cliente/indirizzo auto-generati) che non si possono simulare senza
//    eseguirle davvero.

import { adminDb } from "../firebase-admin";
import { isAlreadyExists } from "./util";
import {
  STATUS_MAPPING,
  processCustomer,
  processArticles,
  processExtraExpenses,
  processAddresses,
  processPayment,
  processDocuments,
  notifyTyre24OrderReceived as notify,
} from "./tyre24Shared";

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

async function processOrder(db, order, dryRun) {
  const orderRef = db.collection("Ordini").doc(order.order);

  // Fast-path: se già esiste, evitiamo di risolvere cliente/articoli/indirizzi
  // per niente. La race residua (creato tra questo check e la .create() sotto)
  // è chiusa dalla .create() stessa più avanti, non da questo check.
  const existing = await orderRef.get();
  if (existing.exists) return { orderDocId: order.order, skipped: true };

  if (dryRun) return { orderDocId: order.order, skipped: false };

  const deliveryCountry = order.shipping.delivery_address.use_alternative_address
    ? order.shipping.delivery_address.address.country
    : order.buyer.address.country;
  const isItaly = deliveryCountry?.toLowerCase().includes("ital") || false;

  const clienteRef = await processCustomer(db, order.buyer, SOURCE);
  const articoli = await processArticles(db, order.positions, isItaly);
  const speseExtra = processExtraExpenses(order, isItaly);

  const totalePFU = isItaly ? articoli.reduce((sum, art) => sum + (art.PFU_Totale || 0), 0) : 0;
  const totaleIVA = isItaly ? (order.total_sum.gross_converted - order.total_sum.net_converted) : 0;
  const totale = isItaly ? order.total_sum.gross_converted : order.total_sum.net_converted;

  const addressData = await processAddresses(order, clienteRef);
  const pagamento = processPayment(order.payment, isItaly);
  const documenti = processDocuments(order.documents);
  const stato = STATUS_MAPPING[order.status.toString()] || "Unknown";

  const orderDoc = {
    ID: order.order,
    DataOra: new Date(order.date),
    Stato: stato,
    Articoli: articoli,
    Spese_Extra: speseExtra,
    Totale: totale,
    IVA: totaleIVA,
    PFU: totalePFU,
    Cliente: clienteRef,
    Indirizzo_Spedizione: addressData.indirizzoSpedizione,
    Indirizzo_Fatturazione: addressData.indirizzoFatturazione,
    Pagamento: pagamento,
    Documenti: documenti,
    Note: order.comment || "",
    CreatedAt: new Date(),
    Source: SOURCE,
    IsItaly: isItaly,
    T24_Country: order.country || "",
  };

  try {
    await orderRef.create(orderDoc);
  } catch (err) {
    if (isAlreadyExists(err)) return { orderDocId: order.order, skipped: true };
    throw err;
  }

  await notify(order.order, order.country, authToken(), ALZURA_COUNTRY);
  return { orderDocId: order.order, skipped: false };
}

/* ── entry point ──────────────────────────────────────────────────── */

/**
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function runTyre24AnonimoImport(opts = {}) {
  const { dryRun = false } = opts;
  const db = adminDb();
  const result = { processedCount: 0, newCount: 0, updatedCount: 0, skippedCount: 0, errors: [] };

  const orders = await fetchOrdersFromAPI();
  for (const order of orders) {
    try {
      const { skipped } = await processOrder(db, order, dryRun);
      result.processedCount++;
      if (skipped) result.skippedCount++;
      else result.newCount++;
    } catch (err) {
      result.errors.push({ id: order.order, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
