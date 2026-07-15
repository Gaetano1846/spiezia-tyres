// One-off: legge SKU + Peso + EPREL + Label da Firestore Prodotti (T24=false)
// e li scrive su public.prodotti.peso/eprel/label (Spiezia-DB/migrations/027)
// — stesso pattern di backfill-descrizione-foto.mjs (022/024/025/026).
// Pensato per girare DENTRO un container ad-hoc dalla stessa immagine
// (il container di produzione ha rootfs read-only):
//   docker cp scripts/backfill-peso-eprel-label.mjs — vedi Fase 2/3 per il
//   comando esatto docker compose run --rm --no-deps -v ... --entrypoint.

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import pg from "pg";

function getFirestoreDb() {
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!clientEmail || !privateKey || !projectId) {
    throw new Error("Missing Firebase Admin env vars (FIREBASE_ADMIN_CLIENT_EMAIL/PRIVATE_KEY, NEXT_PUBLIC_FIREBASE_PROJECT_ID)");
  }
  if (getApps().length === 0) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
  return getFirestore();
}

function toNumOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const fsDb = getFirestoreDb();
  console.log("[backfill] Leggo Prodotti da Firestore (T24=false)...");
  const snap = await fsDb.collection("Prodotti").where("T24", "==", false).get();
  console.log(`[backfill] ${snap.size} documenti letti.`);

  const rows = [];
  snap.forEach((doc) => {
    const data = doc.data();
    const sku = String(data.SKU || "").trim();
    const peso = toNumOrNull(data.Peso);
    const eprel = typeof data.EPREL === "string" ? data.EPREL.trim() : "";
    const label = typeof data.Label === "string" ? data.Label.trim() : "";
    if (sku && (peso !== null || eprel || label)) {
      rows.push([sku, peso, eprel || null, label || null]);
    }
  });
  console.log(`[backfill] ${rows.length} righe con SKU e almeno uno tra Peso/EPREL/Label valorizzati.`);

  let totalMatched = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const placeholders = chunk.map(([sku, peso, eprel, label], idx) => {
      values.push(sku, peso, eprel, label);
      return `($${idx * 4 + 1}, $${idx * 4 + 2}::numeric, $${idx * 4 + 3}, $${idx * 4 + 4})`;
    });
    const { rowCount } = await pool.query(
      `UPDATE public.prodotti AS p SET peso = v.peso, eprel = v.eprel, label = v.label
       FROM (VALUES ${placeholders.join(", ")}) AS v(sku, peso, eprel, label)
       WHERE p.id = v.sku`,
      values
    );
    totalMatched += rowCount;
    console.log(`[backfill] ...${Math.min(i + CHUNK, rows.length)}/${rows.length} processate, ${totalMatched} righe Postgres aggiornate finora`);
  }

  console.log(`[backfill] Fatto. ${totalMatched}/${rows.length} righe Postgres aggiornate (${rows.length - totalMatched} SKU Firestore senza corrispondenza in public.prodotti).`);
  await pool.end();
}

main().catch((err) => {
  console.error("[backfill] ERRORE:", err);
  process.exit(1);
});
