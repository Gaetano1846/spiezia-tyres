// Sync Fido (fido/credit-limit) clienti (Fase 9-ter) — port 1:1 della Cloud
// Function `Fido_Management_CSV` (crm-3iuocs, europe-west3, entry point
// `syncFidoFromFTP`), sorgente reale riscaricato da GCP. Il file sorgente
// conteneva 3 copie ridondanti della stessa `exports.syncFidoFromFTP`
// (riassegnazioni successive — solo l'ultima è effettivamente in vigore a
// runtime); questo port segue la logica dell'ultima copia.
//
// Stessa logica: scarica un CSV via FTP (formato
// `PartitaIVA;Fido;<valore-intermedio>;Fido_Residuo`, con fallback per righe
// da 2/3 colonne), fa match sui clienti Firestore per `Partita_Iva` (con
// fallback rimuovendo gli zeri iniziali, necessario perché il CSV a volte
// non li ha), scrive `Fido`/`Fido_Residuo`/`Last_Fido_Update`.
//
// Differenze dal sorgente CF originale:
//  - Cache spostata da GCS (gzip) a Postgres (core.stock_sync_cache, source
//    'fido' — nome tabella storico "stock_sync" ma lo schema è un
//    key/value generico, riusato qui senza bisogno di una migration nuova).
//  - Modalità `dryRun`: fetch/parse/diff ma nessuna scrittura Firestore/cache.
//  - Audit log tramite il pattern ImportJobs già in uso per gli altri
//    importer, non la collezione `ImportLogs` custom dell'originale.
//  - Trigger duale: l'endpoint originale era pubblico/non autenticato,
//    chiamato sia da un cron esterno (ogni 3h, verificato via Cloud Logging)
//    sia dal pulsante "Aggiorna Fido" in admin/clienti. Qui entrambi passano
//    dallo stesso endpoint autenticato (secret per il cron, sessione Admin
//    per il pulsante — vedi app/api/client-sync/fido/route.ts).

import Papa from "papaparse";
import { Client as FtpClient } from "basic-ftp";
import { adminDb } from "../firebase-admin";
import { getDb } from "../db";
import { Timestamp } from "firebase-admin/firestore";

const FTP_HOST = process.env.FIDO_FTP_HOST || "";
const FTP_USER = process.env.FIDO_FTP_USER || "";
const FTP_PASSWORD = process.env.FIDO_FTP_PASSWORD || "";
const CACHE_SOURCE = "fido";
const CHUNK_SIZE = 50;
const TOLERANCE = 0.01;

function cleanPartitaIva(value) {
  if (!value) return "";
  let cleaned = String(value).trim();
  if (cleaned.startsWith("'")) cleaned = cleaned.slice(1);
  cleaned = cleaned.replace(/[^0-9]/g, "");
  if (cleaned.length > 0 && cleaned.length < 11) cleaned = cleaned.padStart(11, "0");
  return cleaned;
}

function safeParseFloat(value) {
  if (!value || value === "") return 0;
  const parsed = parseFloat(String(value).replace(",", "."));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseCsvRow(row) {
  if (!row || !row[0]) return null;
  const values = Array.isArray(row) ? row : [row];
  const partitaIva = cleanPartitaIva(values[0]);
  if (!partitaIva) return null;

  if (values.length >= 4) {
    return { partitaIva, fido: safeParseFloat(values[1]), fidoResiduo: safeParseFloat(values[3]) };
  }
  if (values.length === 3) {
    return { partitaIva, fido: safeParseFloat(values[1]), fidoResiduo: safeParseFloat(values[2]) };
  }
  if (values.length === 2) {
    return { partitaIva, fido: safeParseFloat(values[1]), fidoResiduo: safeParseFloat(values[1]) };
  }
  return { partitaIva, fido: 0, fidoResiduo: 0 };
}

async function downloadFromFTP() {
  const client = new FtpClient();
  try {
    await client.access({
      host: FTP_HOST,
      user: FTP_USER,
      password: FTP_PASSWORD,
      secure: true,
      port: 21,
      secureOptions: { rejectUnauthorized: false },
    });
    const chunks = [];
    const { Writable } = await import("node:stream");
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk);
        cb();
      },
    });
    await client.downloadTo(sink, "exportFido.csv");
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    client.close();
  }
}

function needsUpdate(cached, fresh) {
  if (!cached) return true;
  return Math.abs((cached.fido || 0) - fresh.fido) > TOLERANCE || Math.abs((cached.fidoResiduo || 0) - fresh.fidoResiduo) > TOLERANCE;
}

async function readCache() {
  const pool = getDb();
  if (!pool) return {};
  const { rows } = await pool.query("SELECT data FROM core.stock_sync_cache WHERE source = $1", [CACHE_SOURCE]);
  return rows.length > 0 ? rows[0].data : {};
}

async function writeCache(data) {
  const pool = getDb();
  if (!pool) return;
  await pool.query(
    `INSERT INTO core.stock_sync_cache (source, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (source) DO UPDATE SET data = $2, updated_at = now()`,
    [CACHE_SOURCE, JSON.stringify(data)]
  );
}

/** Espande [08620521214] in [08620521214, 8620521214] per il fallback senza zeri iniziali. */
function expandSearchList(partitaIvaList) {
  const expanded = [];
  const backMap = new Map();
  for (const piva of partitaIvaList) {
    expanded.push(piva);
    backMap.set(piva, piva);
    const noZeros = piva.replace(/^0+/, "");
    if (noZeros !== piva && noZeros.length > 0) {
      expanded.push(noZeros);
      backMap.set(noZeros, piva);
    }
  }
  return { unique: Array.from(new Set(expanded)), backMap };
}

async function queryClientsByPartitaIva(db, partitaIvaList) {
  if (partitaIvaList.length === 0) return {};
  const { unique, backMap } = expandSearchList(partitaIvaList);
  const results = {};

  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10);
    const snap = await db.collection("Clienti").where("Partita_Iva", "in", chunk).get();
    snap.forEach((doc) => {
      const data = doc.data();
      const original = backMap.get(data.Partita_Iva);
      if (original && !results[original]) {
        results[original] = { id: doc.id, partitaIva: data.Partita_Iva };
      }
    });
  }
  return results;
}

/**
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function runFidoSync(opts = {}) {
  const { dryRun = false } = opts;
  if (!FTP_HOST || !FTP_USER || !FTP_PASSWORD) throw new Error("FIDO_FTP_HOST / FIDO_FTP_USER / FIDO_FTP_PASSWORD mancanti");

  const csvContent = await downloadFromFTP();
  const parsed = Papa.parse(csvContent, { skipEmptyLines: true });
  const rows = parsed.data.slice(1); // riga 0 = header

  const clients = [];
  for (const row of rows) {
    const client = parseCsvRow(row);
    if (client) clients.push(client);
  }

  const cache = await readCache();
  const toCheck = clients.filter((c) => needsUpdate(cache[c.partitaIva], c));

  if (toCheck.length === 0) {
    return { processedCount: clients.length, newCount: 0, updatedCount: 0, skippedCount: clients.length, errors: [] };
  }

  if (dryRun) {
    return {
      processedCount: clients.length,
      newCount: 0,
      updatedCount: 0,
      skippedCount: clients.length - toCheck.length,
      errors: [],
      dryRunChanged: toCheck.length,
      dryRunSample: toCheck.slice(0, 15).map((c) => ({ partitaIva: c.partitaIva, fido: c.fido, fidoResiduo: c.fidoResiduo })),
    };
  }

  const db = adminDb();
  const firestoreClients = await queryClientsByPartitaIva(
    db,
    toCheck.map((c) => c.partitaIva)
  );

  let updatedCount = 0;
  const errors = [];
  for (let i = 0; i < toCheck.length; i += CHUNK_SIZE) {
    const group = toCheck.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    let batchOps = 0;
    for (const c of group) {
      const match = firestoreClients[c.partitaIva];
      if (!match) continue;
      batch.update(db.collection("Clienti").doc(match.id), {
        Fido: c.fido,
        Fido_Residuo: c.fidoResiduo,
        Last_Fido_Update: Timestamp.now(),
      });
      batchOps++;
    }
    if (batchOps > 0) {
      try {
        await batch.commit();
        updatedCount += batchOps;
      } catch (err) {
        errors.push({ message: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const newCache = { ...cache };
  for (const c of toCheck) newCache[c.partitaIva] = { fido: c.fido, fidoResiduo: c.fidoResiduo };
  await writeCache(newCache);

  return { processedCount: clients.length, newCount: 0, updatedCount, skippedCount: clients.length - toCheck.length, errors };
}
