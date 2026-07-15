// Export CSV catalogo verso il partner AdTyres (Fase 9-quinquies → Fase 2
// decommissioning Firebase, 2026-07-14) — legge public.prodotti (Postgres,
// stessa tabella condivisa già letta da lib/prodottiDb.ts), non più Firestore.
// I prezzi-paese sono popolati live dalla pipeline Prezzo-Gomme
// (prezzo-import-spiezi/tyre24 su cron VPS, repo Prezzo-Gomme/replica) sulla
// stessa tabella. Filtra stock combinato Nola+Nola2+Volla+Roma >= 2 (Portici
// escluso, come sempre) e almeno un prezzo di output non-zero, carica il CSV
// via FTP su ftp.direct-pneus.fr (root, `adtyres.csv`) — stesso server e
// credenziali del tracking ordini AdTyres (ADTYRES_TRACKING_FTP_*).
//
// Categoria: colonna dedicata `categoria_adtyres` (Spiezia-DB/migrations/024),
// popolata da un backfill one-off da Firestore CategoriaID — la colonna
// `categoria` esistente (Auto/SUV/Furgone/Moto) è una tassonomia diversa e
// più grossolana, usata solo dai filtri del sito web: NON intercambiabile
// con quella che il partner si aspetta (verificato confrontando il CSV
// realmente in consegna: es. "Camere D'Aria"/"Cerchi Autocarro" non hanno
// equivalente nei 4 valori di `categoria`).
//
// Niente più fallback immagini da `Modello` (Firestore): verificato che il
// 100% dei prodotti idonei ha già `immagine` popolata su Postgres.
//
// ATTENZIONE compatibilità: intestazioni CSV (incluso il typo "Cetegory"),
// ordine colonne e quoting integrale di ogni campo replicati byte-per-byte
// dall'originale — il parser del partner li assume così.

import { Client as FtpClient } from "basic-ftp";
import { Readable } from "node:stream";
import { getDb } from "../db";

const REMOTE_FILE = "adtyres.csv";
const MIN_STOCK = 2;
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

// pg restituisce le colonne NUMERIC come stringhe (es. "0.00", "87.60") per
// non perdere precisione — a differenza di Firestore, dove Prezzo_X era già
// un number nativo. Senza normalizzare, un prezzo a zero "sopravvive" come
// stringa "0.00" invece del numero 0 (applyDiscount non tocca i valori <=0),
// e il CSV renderizzerebbe "0.00" invece di "0" come faceva l'originale.
function toNum(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

// "Price BE" (Spagna/Belgio/Lussemburgo, listino Benelux) — sempre presente
// ora: l'attivazione a tempo (2026-07-14 09:00 Europe/Rome, confermata da
// Hugo/AdTyres) è passata, niente più gate.
const CSV_HEADERS = [
  "InternalID", "Brand", "tread_design", "Name", "Cod", "EAN", "Cetegory",
  "Stock", "Price IT", "Price FR", "Price GE", "PRICE A", "Price BE", "Image",
  "Width", "Aspect", "Diameter", "Speed index", "Fuel", "Wet", "Season",
  "db", "noise index",
];

const SELECT_SQL = `
  SELECT sku, marca, modello, titolo, ean, categoria_adtyres, immagine,
    larghezza, altezza, diametro, indice_velocita, indice_consumo,
    indice_bagnato, indice_rumorosita, stagione,
    prezzo_privato, prezzo_francia, prezzo_germania, prezzo_austria,
    prezzo_benelux, prezzo_anonimo,
    (stock_nola + stock_nola_2 + stock_volla + stock_roma) AS stock_totale
  FROM public.prodotti
  WHERE t24 = false
    AND (stock_nola + stock_nola_2 + stock_volla + stock_roma) >= $1
    AND (prezzo_privato > 0 OR prezzo_francia > 0 OR prezzo_germania > 0
         OR prezzo_austria > 0 OR prezzo_benelux > 0 OR prezzo_anonimo > 0)
  ORDER BY sku
`;

function transformRow(r) {
  const marca = String(r.marca || "").trim();
  const useAnonymous = ANONYMOUS_PRICE_BRANDS.has(marca.toUpperCase());

  // Pirelli / Bridgestone → il piu basso tra prezzo paese e Prezzo_Anonimo
  // (deciso 2026-07-13: prima si mandava sempre l'Anonimo, ora vince il piu conveniente).
  const prezzoGE = useAnonymous ? lowerOf(toNum(r.prezzo_germania), toNum(r.prezzo_anonimo)) : toNum(r.prezzo_germania);
  const prezzoA = useAnonymous ? lowerOf(toNum(r.prezzo_austria), toNum(r.prezzo_anonimo)) : toNum(r.prezzo_austria);

  return {
    InternalID: r.sku ?? "",
    Brand: marca,
    tread_design: r.modello ?? "",
    Name: r.titolo ?? "",
    Cod: r.sku ?? "",
    EAN: r.ean ?? "",
    Cetegory: r.categoria_adtyres ?? "",
    Stock: Number(r.stock_totale ?? 0),
    "Price IT": applyDiscount(toNum(r.prezzo_privato)),
    "Price FR": applyDiscount(toNum(r.prezzo_francia)),
    "Price GE": applyDiscount(prezzoGE),
    "PRICE A": applyDiscount(prezzoA),
    "Price BE": applyDiscount(toNum(r.prezzo_benelux)),
    Image: r.immagine ?? "",
    Width: r.larghezza ?? "",
    Aspect: r.altezza ?? "",
    Diameter: r.diametro ?? "",
    "Speed index": r.indice_velocita ?? "",
    Fuel: r.indice_consumo ?? "",
    Wet: r.indice_bagnato ?? "",
    Season: r.stagione ?? "",
    // Both 'db' and 'noise index' map allo stesso campo — mirrors l'originale Cloud Function.
    db: r.indice_rumorosita ?? "",
    "noise index": r.indice_rumorosita ?? "",
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
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(CSV_HEADERS.map((h) => escape(r[h])).join(","));
  }
  return lines.join("\n");
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
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");

  // processedCount conta TUTTI i T24=false, non solo quelli idonei — stesso
  // significato che aveva quando il conteggio veniva dall'intera collection
  // Firestore Prodotti prima del filtro stock/prezzo (per non far sembrare
  // un calo di "processedCount" un regressione quando è solo un cambio di
  // fonte dati).
  const { rows: countRows } = await db.query(`SELECT count(*)::int AS n FROM public.prodotti WHERE t24 = false`);
  const processedCount = countRows[0]?.n ?? 0;

  const { rows: dbRows } = await db.query(SELECT_SQL, [MIN_STOCK]);
  const rows = dbRows.map(transformRow);
  const csv = toCsv(rows);
  const skippedCount = processedCount - rows.length;

  if (dryRun) {
    return {
      processedCount,
      newCount: 0,
      updatedCount: 0,
      skippedCount,
      errors: [],
      dryRunExported: rows.length,
      // Solo in dryRun — serve per confrontare l'output contro il CSV live
      // senza fare l'upload reale. Non usato dal cron di produzione (sempre dryRun=false).
      csv,
    };
  }

  await uploadToFtp(csv);

  return {
    processedCount,
    newCount: 0,
    updatedCount: rows.length,
    skippedCount,
    errors: [],
  };
}
