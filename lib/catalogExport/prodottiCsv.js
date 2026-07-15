// Export CSV catalogo prodotti verso il partner b2bgommaservice.it (Fase
// 9-ter → Fase 5 decommissioning Firebase, 2026-07-14) — legge public.prodotti
// (Postgres, stessa tabella già letta da lib/prodottiDb.ts e dall'export
// AdTyres), non più Firestore. Filtra `t24=false` + stock combinato
// (Nola+Nola_2+Roma+Volla, Portici/OCP/T24 esclusi) >= 4, esporta CSV via FTP
// semplice (non SFTP) a b2bgommaservice.it.
//
// A differenza dell'originale Firestore (passthrough schema-less: copiava
// ogni campo del documento tranne una lista di esclusioni), qui lo schema è
// fisso ed esplicito — Postgres non ha "campi extra a sorpresa". Verificato
// via inventario reale sui 2067 prodotti idonei prima del cutover: gli unici
// campi mancanti su Postgres erano Peso/EPREL/Label (dati reali, aggiunti con
// backfill — vedi migrations/027), il resto erano ID di bookkeeping interno
// (eBay/Amazon/Google Merchant) finiti nell'export per caso, esclusi di
// proposito qui. Prezzo_Anonimo resta (il partner lo usa davvero, confermato
// con l'utente) — colonna già esistente, popolata dalla pipeline Prezzo-Gomme.
//
// Trigger: un cron esterno di terze parti (cron-job.org) chiama `/export`
// ogni ~15 minuti — fuori dal nostro controllo, nessuna credenziale
// disponibile per ripuntarlo da qui.

import { Client as FtpClient } from "basic-ftp";
import { Readable } from "node:stream";
import { getDb } from "../db";

const FTP_HOST = process.env.PRODOTTI_CSV_FTP_HOST || "b2bgommaservice.it";
const FTP_USER = process.env.PRODOTTI_CSV_FTP_USER || "";
const FTP_PASSWORD = process.env.PRODOTTI_CSV_FTP_PASSWORD || "";
const REMOTE_FILE = "prodotti_export.csv";
const MIN_STOCK = 4;

const CSV_HEADERS = [
  "CAI", "EAN", "CategoriaID", "Stagione", "Marca", "Modello", "Titolo",
  "Larghezza", "Altezza", "Diametro", "Indice_Carico", "Indice_Velocita",
  "Indice_Consumo", "Indice_Bagnato", "Indice_Rumorosita", "Stock", "Prezzo",
  "Prezzo_Anonimo", "PFU", "Peso", "Immagine", "Label", "EPREL",
];

const SELECT_SQL = `
  SELECT cai, ean, categoria_adtyres, stagione, marca, modello, titolo,
    larghezza, altezza, diametro, indice_carico, indice_velocita,
    indice_consumo, indice_bagnato, indice_rumorosita,
    prezzo_grossista, prezzo_anonimo, pfu, peso, immagine, label, eprel,
    (stock_nola + stock_nola_2 + stock_roma + stock_volla) AS stock_totale
  FROM public.prodotti
  WHERE t24 = false
    AND (stock_nola + stock_nola_2 + stock_roma + stock_volla) >= $1
  ORDER BY sku
`;

// pg restituisce le colonne NUMERIC come stringhe (es. "0.00") — normalizzare
// prima di scrivere il CSV, stesso motivo/pattern di adtyresCsv.js.
function toNum(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

function transformRow(r) {
  return {
    CAI: r.cai ?? "",
    EAN: r.ean ?? "",
    CategoriaID: r.categoria_adtyres ?? "",
    Stagione: r.stagione ?? "",
    Marca: r.marca ?? "",
    Modello: r.modello ?? "",
    Titolo: r.titolo ?? "",
    Larghezza: r.larghezza ?? "",
    Altezza: r.altezza ?? "",
    Diametro: r.diametro ?? "",
    Indice_Carico: r.indice_carico ?? "",
    Indice_Velocita: r.indice_velocita ?? "",
    Indice_Consumo: r.indice_consumo ?? "",
    Indice_Bagnato: r.indice_bagnato ?? "",
    Indice_Rumorosita: r.indice_rumorosita ?? "",
    Stock: Number(r.stock_totale ?? 0),
    Prezzo: toNum(r.prezzo_grossista),
    Prezzo_Anonimo: toNum(r.prezzo_anonimo),
    PFU: toNum(r.pfu),
    Peso: toNum(r.peso),
    Immagine: r.immagine ?? "",
    Label: r.label ?? "",
    EPREL: r.eprel ?? "",
  };
}

// Quoting condizionale (solo se il valore contiene , " o newline) — diverso
// dal quoting integrale di adtyresCsv.js, replica il formato originale già
// consumato da questo partner.
function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows) {
  const lines = [CSV_HEADERS.map(csvEscape).join(",")];
  for (const r of rows) {
    lines.push(CSV_HEADERS.map((h) => csvEscape(r[h] ?? "")).join(","));
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

  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");

  const { rows: countRows } = await db.query(`SELECT count(*)::int AS n FROM public.prodotti WHERE t24 = false`);
  const processedCount = countRows[0]?.n ?? 0;

  const { rows: dbRows } = await db.query(SELECT_SQL, [MIN_STOCK]);
  const rows = dbRows.map(transformRow);
  const skippedCount = processedCount - rows.length;

  if (rows.length === 0) {
    return { processedCount, newCount: 0, updatedCount: 0, skippedCount, errors: [], message: "Nessun prodotto con stock >= 4" };
  }

  const csv = toCsv(rows);

  if (dryRun) {
    return {
      processedCount,
      newCount: 0,
      updatedCount: 0,
      skippedCount,
      errors: [],
      dryRunExported: rows.length,
      // Solo in dryRun — serve per confrontare l'output contro il CSV live
      // senza fare l'upload reale. Non usato dal cron esterno (dryRun=false).
      csv,
    };
  }

  await uploadToFtp(csv);

  return { processedCount, newCount: 0, updatedCount: rows.length, skippedCount, errors: [] };
}
