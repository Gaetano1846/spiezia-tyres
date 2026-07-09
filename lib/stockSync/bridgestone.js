// Sync stock Bridgestone/Firestone (Fase 9-bis) — port 1:1 della Cloud Function
// `bridgestoneStockUpdate` (crm-3iuocs, europe-west1), sorgente reale
// riscaricato da GCP. Stessa logica: pull paginato dall'API Azure del
// distributore (vcs-bill-hold.azurewebsites.net/api/v1/getStock), diff contro
// una cache dell'ultimo stato noto, scrittura del solo campo `Stock_OCP` sui
// documenti Prodotti (match su CAI) via Admin SDK.
//
// Differenze dal sorgente CF originale:
//  - Cache spostata da GCS a Postgres (core.stock_sync_cache) — coerente col
//    resto della migrazione, niente bucket dedicato da gestire.
//  - Modalità `dryRun`: fetch + diff ma nessuna scrittura su Firestore/cache.
//  - `bridgestoneStockCleanup` (azzera Stock_OCP per articoli spariti dal
//    listino) non è mai stato schedulato su GCP (nessun Cloud Scheduler job
//    lo chiama) — non portato, fuori scope.

import { adminDb } from "../firebase-admin";
import { getDb } from "../db";

const TOKEN = process.env.BRIDGESTONE_TOKEN || "";
const BASE_URL = process.env.BRIDGESTONE_BASE_URL || "https://vcs-bill-hold.azurewebsites.net";
const CACHE_SOURCE = "bridgestone";

async function fetchPage(body) {
  const url = `${BASE_URL.replace(/\/+$/, "")}/api/v1/getStock`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Upstream ${res.status}`);
    err.details = data;
    throw err;
  }
  return data;
}

async function fetchAllStock(payload) {
  const first = await fetchPage(payload);
  const items = Array.isArray(first.stock) ? [...first.stock] : [];
  const maxPage = Number(first.max_page_number || 1);
  for (let page = 2; page <= maxPage; page++) {
    const next = await fetchPage({ ...payload, page });
    if (Array.isArray(next.stock) && next.stock.length) items.push(...next.stock);
  }
  return items;
}

function buildMap(items) {
  const map = {};
  for (const it of items) {
    const code = String(it.cod_articolo);
    if (code) map[code] = Number(it.giacenza || 0);
  }
  return map;
}

function diffMaps(prev, curr) {
  const changed = [];
  for (const k of Object.keys(curr)) {
    if (prev[k] !== curr[k]) changed.push(k);
  }
  return changed;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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

async function updateFirestore(map, codes) {
  const db = adminDb();
  const coll = db.collection("Prodotti");
  let updated = 0;
  for (const group of chunk(codes, 30)) {
    const snap = await coll.where("CAI", "in", group).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.forEach((doc) => {
      const cai = String(doc.get("CAI"));
      const qty = map[cai];
      if (qty !== undefined) {
        batch.update(doc.ref, { Stock_OCP: qty });
        updated++;
      }
    });
    await batch.commit();
  }
  return updated;
}

/**
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function runBridgestoneStockSync(opts = {}) {
  const { dryRun = false } = opts;
  if (!TOKEN) throw new Error("BRIDGESTONE_TOKEN mancante");

  const items = await fetchAllStock({ token: TOKEN, results_per_page: 5000 });
  const currMap = buildMap(items);
  const prevMap = await readCache();

  const missing = Object.keys(prevMap).filter((k) => !(k in currMap));
  for (const k of missing) currMap[k] = 0;

  const changedCodes = diffMaps(prevMap, currMap);

  if (changedCodes.length === 0) {
    return { processedCount: items.length, newCount: 0, updatedCount: 0, skippedCount: items.length, errors: [] };
  }

  if (dryRun) {
    return {
      processedCount: items.length,
      newCount: 0,
      updatedCount: 0,
      skippedCount: items.length,
      errors: [],
      dryRunChanged: changedCodes.length,
      dryRunSample: changedCodes.slice(0, 15),
    };
  }

  const updatedCount = await updateFirestore(currMap, changedCodes);
  await writeCache(currMap);

  return { processedCount: items.length, newCount: 0, updatedCount, skippedCount: items.length - changedCodes.length, errors: [] };
}
