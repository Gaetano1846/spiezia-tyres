// Import ordini Tyre24 "Regular" (clienti registrati, Fase 9) — port 1:1
// della Cloud Function `processOrdersScheduled`/`processOrdersManual`
// (crm-3iuocs, europe-west1), sorgente reale riscaricato da GCP. Quasi
// identica a tyre24Anonimo.js (stessa logica di dominio condivisa via
// tyre24Shared.js) — differisce per fonte dati (pull JSON via FTP invece di
// chiamata diretta all'API Alzura) e token (`T24_TOKEN` invece di
// `T24_ANON_TOKEN`).
//
// Scrittura diretta su Postgres (core.ordini/ordine_articoli/clienti) invece
// di Firestore — stesso cutover Postgres-first di tyre24Anonimo.js, vedi
// quel file per il ragionamento completo. Il cursore FTP
// (System/Tyre24Import.lastProcessedAt) resta invece su Firestore: è stato
// dello scheduler, non dato ordine, e non c'è motivo di spostarlo.
//
// Differenze dal sorgente CF originale:
//  - Idempotenza via PRIMARY KEY + `ON CONFLICT DO NOTHING` su core.ordini.id
//    (equivalente esatto del `.create()` Firestore usato nella versione
//    precedente di questo file).
//  - Credenziali FTP spostate da hardcoded nel sorgente a env var
//    (`T24_FTP_HOST/USER/PASSWORD/PORT`).
//  - Modalità `dryRun`: scarica e parsa i file FTP (nessun side-effect sul
//    server FTP), verifica solo quali ordini risultano nuovi su Postgres
//    senza risolvere cliente/articoli/indirizzi né scrivere — e soprattutto
//    **non avanza il cursore `System/Tyre24Import.lastProcessedAt`**: quel
//    documento è ancora scritto dalla Cloud Function GCP reale finché non
//    viene disabilitato Cloud Scheduler lato GCP in fase di cutover.

import * as ftp from "basic-ftp";
import { Writable } from "node:stream";
import { adminDb } from "../firebase-admin";
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

const FTP_CONFIG = {
  host: process.env.T24_FTP_HOST || "",
  user: process.env.T24_FTP_USER || "",
  password: process.env.T24_FTP_PASSWORD || "",
  port: Number(process.env.T24_FTP_PORT || 21),
  secure: true,
  secureOptions: { rejectUnauthorized: false },
};

const ALZURA_COUNTRY = "de";
const SOURCE = "Tyre24";
const MAX_FILES_PER_RUN = 50;

function authToken() {
  const token = process.env.T24_TOKEN;
  if (!token) throw new Error("Missing T24_TOKEN");
  return token;
}

/* ── cursore ultimo run (System/Tyre24Import, resta su Firestore) ─── */

export async function getLastRunTimestamp(db) {
  const doc = await db.collection("System").doc("Tyre24Import").get();
  if (!doc.exists || !doc.data().lastProcessedAt) return null;
  const data = doc.data().lastProcessedAt;
  return data.toDate ? data.toDate() : new Date(data);
}

async function updateLastRunTimestamp(db, date) {
  await db.collection("System").doc("Tyre24Import").set({ lastProcessedAt: date, updatedAt: new Date() }, { merge: true });
}

/* ── pull FTP ─────────────────────────────────────────────────────── */

// Ogni elemento: { orderData, modifiedAt, name } — modifiedAt/name servono al
// chiamante per calcolare fino a dove è sicuro avanzare il cursore (vedi
// runTyre24RegularImport), non solo per processare gli ordini.
export async function getOrderFilesFromFTP(lastRunTime) {
  const client = new ftp.Client();
  const orderFiles = [];

  try {
    await client.access(FTP_CONFIG);

    const files = await client.list();
    let jsonFiles = files.filter((f) => f.name.endsWith(".json"));

    if (lastRunTime) {
      jsonFiles = jsonFiles.filter((f) => f.modifiedAt && f.modifiedAt > lastRunTime);
    }

    jsonFiles.sort((a, b) => {
      if (!a.modifiedAt) return 1;
      if (!b.modifiedAt) return -1;
      return b.modifiedAt - a.modifiedAt;
    });

    if (jsonFiles.length > MAX_FILES_PER_RUN) {
      jsonFiles = jsonFiles.slice(0, MAX_FILES_PER_RUN);
    }

    jsonFiles.sort((a, b) => {
      if (!a.modifiedAt) return -1;
      if (!b.modifiedAt) return 1;
      return a.modifiedAt - b.modifiedAt;
    });

    for (const file of jsonFiles) {
      const chunks = [];
      const writableStream = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      });

      await client.downloadTo(writableStream, file.name);
      const buffer = Buffer.concat(chunks);

      let orderData;
      try {
        orderData = JSON.parse(buffer.toString());
      } catch {
        continue;
      }

      orderFiles.push({ orderData, modifiedAt: file.modifiedAt, name: file.name });
    }
  } finally {
    client.close();
  }

  return { files: orderFiles };
}

/* ── single order processing ─────────────────────────────────────── */

// Esportata per il test di idempotenza, stesso motivo di processXmlOrder in
// adtyres.js — esercita la logica reale senza passare dal vero server FTP.
export async function processIndividualOrder(order, dryRun) {
  const alreadyExists = await orderExistsPg(order.order);
  if (alreadyExists) return { orderDocId: order.order, skipped: true };

  if (dryRun) return { orderDocId: order.order, skipped: false };

  const deliveryCountry = order.shipping.delivery_address.use_alternative_address
    ? order.shipping.delivery_address.address.country
    : order.buyer.address.country;
  const isItaly = deliveryCountry?.toLowerCase().includes("ital") || false;

  let result;
  try {
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

    const totalePFU = isItaly ? articoli.reduce((sum, art) => sum + (art.pfu * art.quantita || 0), 0) : 0;
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
        pfu: totalePFU,
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

async function processOrderFile(orderResponse, dryRun, result) {
  if (!orderResponse.data || !Array.isArray(orderResponse.data)) return;

  for (const order of orderResponse.data) {
    try {
      const { skipped } = await processIndividualOrder(order, dryRun);
      result.processedCount++;
      if (skipped) result.skippedCount++;
      else result.newCount++;
    } catch (err) {
      result.errors.push({ id: order.order, message: err instanceof Error ? err.message : String(err) });
    }
  }
}

/* ── entry point ──────────────────────────────────────────────────── */

/**
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function runTyre24RegularImport(opts = {}) {
  const { dryRun = false } = opts;
  const db = adminDb();
  const result = { processedCount: 0, newCount: 0, updatedCount: 0, skippedCount: 0, errors: [] };

  const lastRunTime = await getLastRunTimestamp(db);
  const { files: orderFiles } = await getOrderFilesFromFTP(lastRunTime);

  // Cursore sicuro: avanza solo fino all'ultimo file PRIMA del primo che ha
  // avuto un errore — un ordine fallito (e tutti i file successivi, anche
  // quelli riusciti in questo stesso run) restano sotto il cursore e vengono
  // ripresentati al prossimo run, così un ordine fallito nel parsing non
  // sparisce mai silenziosamente. Gli ordini già importati con successo
  // vengono semplicemente re-skippati (orderExistsPg), nessun costo reale nel
  // rielaborarli. Tutti i file vengono comunque processati in questo run (non
  // ci si ferma al primo errore) — solo il cursore resta indietro. Bug reale
  // trovato il 2026-07-09: prima il cursore avanzava incondizionatamente in
  // base al mtime dei file scaricati, perdendo per sempre 4 ordini reali
  // falliti per un bug di parsing prezzi (vedi tyre24Shared.js).
  let safeLatestTimestamp = lastRunTime;
  let hitFailure = false;

  for (const file of orderFiles) {
    const errorsBefore = result.errors.length;
    await processOrderFile(file.orderData, dryRun, result);
    const fileHadError = result.errors.length > errorsBefore;
    if (fileHadError) {
      hitFailure = true;
    } else if (!hitFailure && file.modifiedAt) {
      safeLatestTimestamp = file.modifiedAt;
    }
  }

  if (!dryRun && safeLatestTimestamp && safeLatestTimestamp !== lastRunTime) {
    await updateLastRunTimestamp(db, safeLatestTimestamp);
  }

  return result;
}
