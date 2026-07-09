// Export CSV catalogo prodotti verso il partner b2bgommaservice.it (Fase
// 9-ter) — port 1:1 della Cloud Function `prodotti-csv-export` (crm-3iuocs,
// europe-west3), sorgente reale riscaricato da GCP. Legge Firestore
// `Prodotti` (stessa collezione scritta da import ordini/stock-sync in
// questa app, NON il catalogo Postgres `public.prodotti` di Prezzo-Gomme —
// sono due cataloghi diversi), filtra `T24==false` + stock combinato >= 4,
// esporta CSV via FTP semplice (non SFTP) a b2bgommaservice.it.
//
// Trigger originale: un cron esterno di terze parti (cron-job.org, verificato
// via Cloud Logging — nessun Cloud Scheduler GCP coinvolto) chiama
// `/export` ogni ~15 minuti. Il cron esterno va ripuntato o disattivato
// manualmente su cron-job.org dopo il cutover (fuori dal nostro controllo,
// nessuna credenziale disponibile per farlo da qui).
//
// Differenze dal sorgente CF originale:
//  - Niente cache incrementale su /tmp (nel CF originale era comunque fragile
//    — /tmp non persiste in modo affidabile tra invocazioni serverless): ogni
//    run fa un export completo, stesso pattern già usato per Compasal/
//    Piccone/Interprogramm.
//  - `DocumentReference`/`Timestamp` gestiti nativamente (`.path`/ISO string)
//    invece dei marker `__ref__`/`__time__` dell'originale (quei marker sono
//    del formato export REST di Firestore, mai popolati dall'Admin SDK — con
//    ogni probabilità codice morto nell'originale).
//  - Modalità `dryRun`: query + filtro + CSV in memoria, nessun upload FTP.

import { Client as FtpClient } from "basic-ftp";
import { Readable } from "node:stream";
import { adminDb } from "../firebase-admin";

const FTP_HOST = process.env.PRODOTTI_CSV_FTP_HOST || "b2bgommaservice.it";
const FTP_USER = process.env.PRODOTTI_CSV_FTP_USER || "";
const FTP_PASSWORD = process.env.PRODOTTI_CSV_FTP_PASSWORD || "";
const REMOTE_FILE = "prodotti_export.csv";

const EXCLUDED_FIELDS = new Set([
  "T24", "Stock_T24", "Prezzo_T24", "Prezzo_Acquisto", "Prezzo_Austria",
  "Prezzo_Benelux", "Prezzo_Francia", "Prezzo_Germania", "Prezzo_Gommista",
  "Prezzo_Polonia", "Prezzo_Privato", "Prezzo_Tyre24", "Prezzo_Grossista", "_categoryPath", "hasStock",
  "Last_Modification", "Categoria", "Stock_Portici", "Gabbia", "id", "Index",
  "Stock_Nola_2_Occupato", "Stock_Nola_Occupato", "Stock_Roma_Occupato",
]);

const STOCK_FIELDS = ["Stock_Nola_2", "Stock_Nola", "Stock_Roma", "Stock_Volla"];

const COLUMN_ORDER = [
  "CAI", "EAN", "CategoriaID", "Stagione", "Marca", "Modello", "Titolo",
  "Larghezza", "Altezza", "Diametro", "Indice_Carico", "Indice_Velocita",
  "Indice_Consumo", "Indice_Bagnato", "Indice_Rumorosita", "Stock", "Prezzo",
  "PFU", "Peso", "Immagine", "Label", "EPREL",
];

function serializeValue(value) {
  if (value && typeof value === "object") {
    if (typeof value.path === "string" && typeof value.id === "string") return value.path; // DocumentReference
    if (typeof value.toDate === "function") return value.toDate().toISOString(); // Timestamp
    return JSON.stringify(value);
  }
  return value;
}

function processProduct(product) {
  let totalStock = 0;
  for (const field of STOCK_FIELDS) {
    if (typeof product[field] === "number") totalStock += product[field];
  }
  if (totalStock < 4) return null;

  const processed = {};
  for (const [key, value] of Object.entries(product)) {
    if (EXCLUDED_FIELDS.has(key) || STOCK_FIELDS.includes(key)) continue;
    processed[key] = serializeValue(value);
  }
  if (product.Prezzo_Grossista !== undefined) processed.Prezzo = product.Prezzo_Grossista;
  processed.Stock = totalStock;
  return processed;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(products) {
  const allHeaders = new Set();
  for (const p of products) for (const k of Object.keys(p)) allHeaders.add(k);

  const priorityHeaders = COLUMN_ORDER.filter((c) => allHeaders.has(c));
  const remainingHeaders = Array.from(allHeaders).filter((c) => !COLUMN_ORDER.includes(c)).sort();
  const headers = [...priorityHeaders, ...remainingHeaders];

  const lines = [headers.map(csvEscape).join(",")];
  for (const p of products) {
    lines.push(headers.map((h) => csvEscape(p[h] ?? "")).join(","));
  }
  return lines.join("\n");
}

async function uploadToFtp(csvContent) {
  const client = new FtpClient();
  try {
    await client.access({
      host: FTP_HOST,
      user: FTP_USER,
      password: FTP_PASSWORD,
      secure: false,
      secureOptions: { rejectUnauthorized: false },
    });
    await client.uploadFrom(Readable.from(Buffer.from(csvContent, "utf8")), REMOTE_FILE);
  } finally {
    client.close();
  }
}

/**
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function runProdottiCsvExport(opts = {}) {
  const { dryRun = false } = opts;
  if (!FTP_USER || !FTP_PASSWORD) throw new Error("PRODOTTI_CSV_FTP_USER / PRODOTTI_CSV_FTP_PASSWORD mancanti");

  const db = adminDb();
  const snap = await db.collection("Prodotti").where("T24", "==", false).get();

  const products = [];
  snap.forEach((doc) => {
    const processed = processProduct({ id: doc.id, ...doc.data() });
    if (processed) products.push(processed);
  });

  if (products.length === 0) {
    return { processedCount: 0, newCount: 0, updatedCount: 0, skippedCount: 0, errors: [], message: "Nessun prodotto con stock >= 4" };
  }

  if (dryRun) {
    return {
      processedCount: snap.size,
      newCount: 0,
      updatedCount: 0,
      skippedCount: snap.size - products.length,
      errors: [],
      dryRunExported: products.length,
    };
  }

  const csv = buildCsv(products);
  await uploadToFtp(csv);

  return { processedCount: snap.size, newCount: 0, updatedCount: products.length, skippedCount: snap.size - products.length, errors: [] };
}
