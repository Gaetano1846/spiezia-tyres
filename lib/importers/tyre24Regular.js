// Import ordini Tyre24 "Regular" (clienti registrati, Fase 9) — port 1:1
// della Cloud Function `processOrdersScheduled`/`processOrdersManual`
// (crm-3iuocs, europe-west1), sorgente reale riscaricato da GCP. Quasi
// identica a tyre24Anonimo.js (stessa logica processCustomer/processArticles/
// ecc, condivisa via tyre24Shared.js) — differisce solo per fonte dati (pull
// JSON via FTP invece di chiamata diretta all'API Alzura) e token
// (`T24_TOKEN` invece di `T24_ANON_TOKEN`).
//
// Differenze dal sorgente CF originale:
//  - `Ordini.doc(id).create()` invece di `.get()`+`.set()` — chiude la
//    finestra TOCTOU dell'idempotenza (vedi Fase 9 del piano).
//  - Credenziali FTP spostate da hardcoded nel sorgente a env var
//    (`T24_FTP_HOST/USER/PASSWORD/PORT`).
//  - Modalità `dryRun`: scarica e parsa i file FTP (nessun side-effect sul
//    server FTP, i file non vengono spostati/cancellati dall'originale né
//    dalla porta), verifica solo quali ordini risultano nuovi senza risolvere
//    cliente/articoli/indirizzi né scrivere — e soprattutto **non avanza il
//    cursore `System/Tyre24Import.lastProcessedAt`**: quel documento è ancora
//    scritto dalla Cloud Function GCP reale finché non viene disabilitato
//    Cloud Scheduler lato GCP in fase di cutover; avanzarlo da qui in dry-run
//    corromperebbe il cursore della CF live.

import * as ftp from "basic-ftp";
import { Writable } from "node:stream";
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

/* ── cursore ultimo run (System/Tyre24Import) ────────────────────── */

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

export async function getOrderFilesFromFTP(lastRunTime) {
  const client = new ftp.Client();
  const orderFiles = [];
  let latestFileDate = lastRunTime;

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

      orderFiles.push(orderData);
      if (file.modifiedAt && (!latestFileDate || file.modifiedAt > latestFileDate)) {
        latestFileDate = file.modifiedAt;
      }
    }
  } finally {
    client.close();
  }

  return { files: orderFiles, latestTimestamp: latestFileDate };
}

/* ── single order processing ─────────────────────────────────────── */

// Esportata per il test di idempotenza, stesso motivo di processXmlOrder in
// adtyres.js — esercita la logica reale senza passare dal vero server FTP.
export async function processIndividualOrder(db, order, dryRun) {
  const orderRef = db.collection("Ordini").doc(order.order);

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

async function processOrderFile(db, orderResponse, dryRun, result) {
  if (!orderResponse.data || !Array.isArray(orderResponse.data)) return;

  for (const order of orderResponse.data) {
    try {
      const { skipped } = await processIndividualOrder(db, order, dryRun);
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
  const { files: orderFiles, latestTimestamp } = await getOrderFilesFromFTP(lastRunTime);

  for (const orderData of orderFiles) {
    await processOrderFile(db, orderData, dryRun, result);
  }

  if (!dryRun && latestTimestamp) {
    await updateLastRunTimestamp(db, latestTimestamp);
  }

  return result;
}
