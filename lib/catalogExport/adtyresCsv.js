// Export CSV catalogo verso il partner AdTyres (Fase 9-quinquies) — port
// della Cloud Function `exportadtyres` (crm-3iuocs, europe-west3), sorgente
// reale riscaricato da GCP. Legge Firestore `Prodotti` (T24==false), filtra
// stock combinato Nola+Nola2+Volla+Roma >= 2 e almeno un prezzo di output
// non-zero, completa le immagini mancanti dalla collezione `Modello`, carica
// il CSV via FTP su ftp.direct-pneus.fr (root, `adtyres.csv`) — stesso server
// e credenziali del tracking ordini AdTyres (ADTYRES_TRACKING_FTP_*).
//
// Differenze dal sorgente CF originale:
//  - Niente cache incrementale NDJSON su GCS + cursore `exports/adTyresCsv`:
//    ogni run rifà l'export completo da Firestore — stesso pattern (già
//    validato) di prodottiCsv.js su questa stessa collezione. Il risultato è
//    equivalente: la cache GCP accumulava lo stato corrente riga per riga,
//    il full rebuild lo produce direttamente.
//  - Modalità `dryRun`: query + filtri + CSV in memoria, nessun upload FTP.
//
// ATTENZIONE compatibilità: intestazioni CSV (incluso il typo "Cetegory"),
// ordine colonne e quoting integrale di ogni campo replicati byte-per-byte
// dall'originale — il parser del partner li assume così.

import { Client as FtpClient } from "basic-ftp";
import { Readable } from "node:stream";
import { adminDb } from "../firebase-admin";

const REMOTE_FILE = "adtyres.csv";
const MIN_STOCK = 2;
const STOCK_FIELDS = ["Stock_Nola", "Stock_Nola_2", "Stock_Volla", "Stock_Roma"];
const ANONYMOUS_PRICE_BRANDS = new Set(["PIRELLI", "BRIDGESTONE"]);
// Sconto applicato a TUTTI i prezzi mandati ad AdTyres, tutte le marche/colonne (deciso 2026-07-13).
const GLOBAL_DISCOUNT = 0.01;

/** Il piu basso tra due prezzi, ignorando i valori assenti/non numerici. "" se nessuno dei due e valido. */
function lowerOf(a, b) {
  const na = Number(a);
  const nb = Number(b);
  const validA = Number.isFinite(na) && a !== "" && a != null;
  const validB = Number.isFinite(nb) && b !== "" && b != null;
  if (validA && validB) return Math.min(na, nb);
  if (validA) return na;
  if (validB) return nb;
  return "";
}

function applyDiscount(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return price;
  return Math.round(n * (1 - GLOBAL_DISCOUNT) * 100) / 100;
}

const CSV_HEADERS_BASE = [
  "InternalID", "Brand", "tread_design", "Name", "Cod", "EAN", "Cetegory",
  "Stock", "Price IT", "Price FR", "Price GE", "PRICE A", "Image",
  "Width", "Aspect", "Diameter", "Speed index", "Fuel", "Wet", "Season",
  "db", "noise index",
];

// "Price BE" (Spagna/Belgio/Lussemburgo, listino Benelux) — confermata da
// Hugo (AdTyres) via email il 2026-07-13, ma attivazione posticipata a sua
// richiesta: non prima delle 9:00 del 2026-07-14 (Europe/Rome), per dargli
// tempo di prepararsi lato loro. Il campo è sempre calcolato in
// transformProductData(); qui si decide solo se finisce nell'intestazione.
const PRICE_BE_ACTIVATION = new Date("2026-07-14T09:00:00+02:00");
const PRICE_BE_HEADER = "Price BE";

function csvHeaders() {
  if (Date.now() < PRICE_BE_ACTIVATION.getTime()) return CSV_HEADERS_BASE;
  const idx = CSV_HEADERS_BASE.indexOf("PRICE A");
  return [
    ...CSV_HEADERS_BASE.slice(0, idx + 1),
    PRICE_BE_HEADER,
    ...CSV_HEADERS_BASE.slice(idx + 1),
  ];
}

function computeStock(data) {
  let sum = 0;
  for (const k of STOCK_FIELDS) {
    const v = Number(data[k] || 0);
    sum += Number.isFinite(v) ? v : 0;
  }
  return sum;
}

function hasAtLeastOnePrice(data) {
  const marca = String(data.Marca || "").trim();
  const useAnonymous = ANONYMOUS_PRICE_BRANDS.has(marca.toUpperCase());
  const prices = [
    Number(data.Prezzo_Privato || 0),
    Number(data.Prezzo_Francia || 0),
    useAnonymous ? Number(data.Prezzo_Anonimo || data.Prezzo_Germania || 0) : Number(data.Prezzo_Germania || 0),
    useAnonymous ? Number(data.Prezzo_Anonimo || data.Prezzo_Austria || 0) : Number(data.Prezzo_Austria || 0),
    Number(data.Prezzo_Benelux || 0),
  ];
  return prices.some((v) => Number.isFinite(v) && v > 0);
}

function transformProductData(data) {
  const stock = computeStock(data);
  const marca = String(data.Marca || "").trim();
  const useAnonymous = ANONYMOUS_PRICE_BRANDS.has(marca.toUpperCase());

  // Pirelli / Bridgestone → il piu basso tra prezzo paese e Prezzo_Anonimo
  // (deciso 2026-07-13: prima si mandava sempre l'Anonimo, ora vince il piu conveniente).
  const prezzoGE = useAnonymous ? lowerOf(data.Prezzo_Germania, data.Prezzo_Anonimo) : (data.Prezzo_Germania ?? "");
  const prezzoA = useAnonymous ? lowerOf(data.Prezzo_Austria, data.Prezzo_Anonimo) : (data.Prezzo_Austria ?? "");

  return {
    InternalID: data.SKU ?? "",
    Brand: marca,
    tread_design: data.Modello ?? "",
    Name: data.Titolo ?? "",
    Cod: data.SKU ?? "",
    EAN: data.EAN ?? "",
    Cetegory: data.CategoriaID ?? "",
    Stock: stock,
    "Price IT": applyDiscount(data.Prezzo_Privato ?? ""),
    "Price FR": applyDiscount(data.Prezzo_Francia ?? ""),
    "Price GE": applyDiscount(prezzoGE),
    "PRICE A": applyDiscount(prezzoA),
    "Price BE": applyDiscount(data.Prezzo_Benelux ?? ""),
    Image: data.Immagine ?? "",
    Width: data.Larghezza ?? "",
    Aspect: data.Altezza ?? "",
    Diameter: data.Diametro ?? "",
    "Speed index": data.Indice_Velocita ?? "",
    Fuel: data.Indice_Consumo ?? "",
    Wet: data.Indice_Bagnato ?? "",
    Season: data.Stagione ?? "",
    db: data.Indice_Rumorosita ?? "",
    "noise index": data.Indice_Rumorosita ?? "",
  };
}

// Quoting integrale di ogni campo, identico all'originale (diverso dal
// quoting condizionale di prodottiCsv.js — qui il partner riceve da sempre
// ogni valore tra virgolette).
function toCsv(rows) {
  const escape = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return `"${s}"`;
  };
  const headers = csvHeaders();
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => escape(r[h])).join(","));
  }
  return lines.join("\n");
}

// Completa Image mancante dalla collezione Modello (query "in" max 30 valori)
async function fillMissingImages(db, rows) {
  const missing = new Set();
  for (const row of rows) {
    if (!row.Image && row.tread_design) missing.add(String(row.tread_design).trim());
  }
  if (missing.size === 0) return;

  const modelloImageMap = new Map();
  const names = Array.from(missing);
  for (let i = 0; i < names.length; i += 30) {
    const batch = names.slice(i, i + 30);
    try {
      const snap = await db.collection("Modello").where("Nome", "in", batch).get();
      snap.forEach((d) => {
        const md = d.data();
        if (md.Immagine) modelloImageMap.set(String(md.Nome).trim(), md.Immagine);
      });
    } catch (err) {
      console.error("[adtyres-csv] Modello lookup error:", err?.message || err);
    }
  }

  for (const row of rows) {
    if (!row.Image && row.tread_design) {
      const img = modelloImageMap.get(String(row.tread_design).trim());
      if (img) row.Image = img;
    }
  }
}

async function uploadToFtp(csvContent) {
  const host = process.env.ADTYRES_TRACKING_FTP_HOST;
  const user = process.env.ADTYRES_TRACKING_FTP_USER;
  const password = process.env.ADTYRES_TRACKING_FTP_PASSWORD;
  if (!host || !user || !password) throw new Error("Missing ADTYRES_TRACKING_FTP_HOST/USER/PASSWORD");

  const client = new FtpClient();
  client.ftp.verbose = false;
  try {
    await client.access({ host, user, password, secure: false });
    await client.uploadFrom(Readable.from(Buffer.from(csvContent, "utf8")), REMOTE_FILE);
  } finally {
    client.close();
  }
}

/**
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function runAdtyresCsvExport(opts = {}) {
  const { dryRun = false } = opts;
  const db = adminDb();

  const snap = await db.collection("Prodotti").where("T24", "==", false).get();

  const rows = [];
  let skippedStock = 0;
  let skippedPrice = 0;
  snap.forEach((doc) => {
    const data = doc.data();
    if (!String(data.SKU || doc.id || "").trim()) return;
    if (computeStock(data) < MIN_STOCK) { skippedStock++; return; }
    if (!hasAtLeastOnePrice(data)) { skippedPrice++; return; }
    rows.push(transformProductData(data));
  });

  await fillMissingImages(db, rows);
  const csv = toCsv(rows);

  if (dryRun) {
    return {
      processedCount: snap.size,
      newCount: 0,
      updatedCount: 0,
      skippedCount: skippedStock + skippedPrice,
      errors: [],
      dryRunExported: rows.length,
    };
  }

  await uploadToFtp(csv);

  return {
    processedCount: snap.size,
    newCount: 0,
    updatedCount: rows.length,
    skippedCount: skippedStock + skippedPrice,
    errors: [],
  };
}
