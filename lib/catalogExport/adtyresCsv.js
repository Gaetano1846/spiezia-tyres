// Export CSV catalogo verso il partner AdTyres (Fase 9-quinquies → Fase 2
// decommissioning Firebase, 2026-07-14) — legge public.prodotti (Postgres,
// stessa tabella condivisa già letta da lib/prodottiDb.ts), non più Firestore.
// I prezzi-paese sono popolati live dalla pipeline Prezzo-Gomme
// (prezzo-import-spiezi/tyre24 su cron VPS, repo Prezzo-Gomme/replica) sulla
// stessa tabella. Filtra stock combinato Nola+Nola2+Volla >= 2 (Portici e
// Roma esclusi, richiesto 2026-07-24) e almeno un prezzo di output non-zero, carica il CSV
// via FTP su ftp.direct-pneus.fr (root, `adtyres.csv`) — stesso server e
// credenziali del tracking ordini AdTyres (ADTYRES_TRACKING_FTP_*).
//
// Stesso file (stesso sconto, stesse colonne) caricato anche su tyre-world.de
// (host reale `tyretyre.de`, confermato dal banner FTP "Welcome to Tyre-World
// Data-Exchange" — non un refuso), cartella `/upload/stock/`, richiesto
// 2026-08-07. Il fallimento di QUESTO secondo upload non deve far fallire il
// job intero (AdTyres resta l'integrazione primaria, monitorata da anni):
// viene solo loggato in `errors` → job marcato "done_with_errors".
//
// Dal 2026-08-19 il file TyreWorld NON è più byte-identico ad AdTyres: su
// richiesta dell'utente, TyreWorld (da sola, AdTyres resta invariato) applica
// +10€ sulle colonne prezzo non-Italia (FR/GE/A/BE) per Autocarro (qualsiasi
// diametro) e AgroIndustriali con diametro > 22" — vedi
// SURCHARGE_CATEGORIES/needsSurcharge/applyTyreworldSurcharge più sotto.
// Stessa regola applicata in parallelo a 07ZR/Distri2B nel repo Prezzo-Gomme
// (scripts/export-pipeline/export-07zr.mjs, colonne FR/DE/AT — niente BE lì).
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
//
// "Price IT" = prezzo_t24 (non prezzo_privato): cambiato il 2026-07-27 su
// richiesta esplicita dell'utente — il listino Italia da mandare ai partner
// via file è quello T24, non il prezzo privato/retail (fino a questa data il
// campo era prezzo_privato fin dalla Cloud Function originale, mai un bug di
// migrazione: semplice scelta mai rivista).

import { Client as FtpClient } from "basic-ftp";
import { Readable } from "node:stream";
import { getDb } from "../db";

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
    prezzo_t24, prezzo_francia, prezzo_germania, prezzo_austria,
    prezzo_benelux, prezzo_anonimo,
    (stock_nola + stock_nola_2 + stock_volla) AS stock_totale
  FROM public.prodotti
  WHERE t24 = false
    AND (stock_nola + stock_nola_2 + stock_volla) >= $1
    AND (prezzo_t24 > 0 OR prezzo_francia > 0 OR prezzo_germania > 0
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
    "Price IT": applyDiscount(toNum(r.prezzo_t24)),
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

// Secondo upload (tyre-world.de) usa una sotto-cartella FTP dedicata già
// esistente sull'account (/upload/stock/), a differenza di AdTyres che scrive
// in root.
const TYREWORLD_REMOTE_FILE = "upload/stock/tyreworld.csv";

// Sovrapprezzo estero SOLO per TyreWorld (richiesto dall'utente 2026-08-19):
// Autocarro a qualsiasi diametro, AgroIndustriali solo se diametro > 22" —
// stessi valori categoria_adtyres verificati su public.prodotti. AdTyres
// resta il file di sempre, invariato: da qui in poi il CSV TyreWorld non è
// più byte-identico a quello AdTyres.
const SURCHARGE_CATEGORIES = { AUTOCARRO: "Pneumatici Autocarro", AGRO: "Pneumatici AgroIndustriali" };
const SURCHARGE_AGRO_MIN_DIAMETER = 22;
const SURCHARGE_AMOUNT = 10;
// Ogni colonna prezzo tranne "Price IT" — TyreWorld riceve anche il Benelux, a
// differenza di 07ZR (vedi export-07zr.mjs nel repo Prezzo-Gomme, che non ha
// una colonna BE).
const SURCHARGE_COLUMNS = ["Price FR", "Price GE", "PRICE A", "Price BE"];

function needsSurcharge(categoria, diametro) {
  if (categoria === SURCHARGE_CATEGORIES.AUTOCARRO) return true;
  if (categoria === SURCHARGE_CATEGORIES.AGRO) {
    const d = Number(diametro);
    return Number.isFinite(d) && d > SURCHARGE_AGRO_MIN_DIAMETER;
  }
  return false;
}

function addSurcharge(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return price;
  return Math.round((n + SURCHARGE_AMOUNT) * 100) / 100;
}

/** Riga AdTyres già trasformata (transformRow) + il DB row originale (per
 *  categoria_adtyres/diametro, non presenti nell'output AdTyres) → riga
 *  TyreWorld, identica salvo il sovrapprezzo estero sulle categorie idonee. */
function applyTyreworldSurcharge(row, dbRow) {
  if (!needsSurcharge(dbRow.categoria_adtyres, dbRow.diametro)) return row;
  const surcharged = { ...row };
  for (const col of SURCHARGE_COLUMNS) surcharged[col] = addSurcharge(row[col]);
  return surcharged;
}

async function uploadToFtp(csvContent, { host, user, password, remoteFile }) {
  const client = new FtpClient();
  client.ftp.verbose = false;
  try {
    await client.access({ host, user, password, secure: false });
    await client.uploadFrom(Readable.from(Buffer.from(csvContent, "utf8")), remoteFile);
  } finally {
    client.close();
  }
}

async function uploadToAdtyresFtp(csvContent) {
  const host = process.env.ADTYRES_TRACKING_FTP_HOST;
  const user = process.env.ADTYRES_TRACKING_FTP_USER;
  const password = process.env.ADTYRES_TRACKING_FTP_PASSWORD;
  if (!host || !user || !password) throw new Error("Missing ADTYRES_TRACKING_FTP_HOST/USER/PASSWORD");
  await uploadToFtp(csvContent, { host, user, password, remoteFile: "adtyres.csv" });
}

async function uploadToTyreworldFtp(csvContent) {
  const host = process.env.TYREWORLD_FTP_HOST;
  const user = process.env.TYREWORLD_FTP_USER;
  const password = process.env.TYREWORLD_FTP_PASSWORD;
  if (!host || !user || !password) throw new Error("Missing TYREWORLD_FTP_HOST/USER/PASSWORD");
  await uploadToFtp(csvContent, { host, user, password, remoteFile: TYREWORLD_REMOTE_FILE });
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
  const tyreworldRows = dbRows.map((r, i) => applyTyreworldSurcharge(rows[i], r));
  const tyreworldCsv = toCsv(tyreworldRows);
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
      tyreworldCsv,
    };
  }

  await uploadToAdtyresFtp(csv);

  const errors = [];
  try {
    await uploadToTyreworldFtp(tyreworldCsv);
  } catch (err) {
    errors.push({ id: "tyreworld", message: err instanceof Error ? err.message : String(err) });
  }

  return {
    processedCount,
    newCount: 0,
    updatedCount: rows.length,
    skippedCount,
    errors,
  };
}
