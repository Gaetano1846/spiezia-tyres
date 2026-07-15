// One-off: legge SKU + CategoriaID da Firestore Prodotti (T24=false) e li
// scrive su public.prodotti.categoria_adtyres (Spiezia-DB/migrations/024) —
// stesso pattern già usato per il backfill degli stock "Occupato" (022).
// Pensato per girare DENTRO il container di produzione (già ha firebase-admin,
// pg, e tutte le env var necessarie — FIREBASE_ADMIN_*, DATABASE_URL):
//   docker cp scripts/backfill-categoria-adtyres.mjs spiezia-b2b2:/app/backfill-categoria-adtyres.mjs
//   docker exec spiezia-b2b2 node backfill-categoria-adtyres.mjs
//   docker exec spiezia-b2b2 rm backfill-categoria-adtyres.mjs

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
    const categoriaId = data.CategoriaID;
    if (sku && categoriaId != null && String(categoriaId).trim()) {
      rows.push([sku, String(categoriaId).trim()]);
    }
  });
  console.log(`[backfill] ${rows.length} righe con SKU+CategoriaID validi (${snap.size - rows.length} scartate: SKU o CategoriaID mancante).`);

  let totalMatched = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const placeholders = chunk.map(([sku, cat], idx) => {
      values.push(sku, cat);
      return `($${idx * 2 + 1}, $${idx * 2 + 2})`;
    });
    const { rowCount } = await pool.query(
      `UPDATE public.prodotti AS p SET categoria_adtyres = v.cat
       FROM (VALUES ${placeholders.join(", ")}) AS v(sku, cat)
       WHERE p.id = v.sku`,
      values
    );
    totalMatched += rowCount;
    console.log(`[backfill] ...${Math.min(i + CHUNK, rows.length)}/${rows.length} processate, ${totalMatched} righe Postgres aggiornate finora`);
  }

  console.log(`[backfill] Fatto. ${totalMatched}/${rows.length} righe Postgres aggiornate (${rows.length - totalMatched} SKU Firestore senza corrispondenza in public.prodotti — atteso, stesso motivo del backfill Stock_Occupato).`);
  await pool.end();
}

main().catch((err) => {
  console.error("[backfill] ERRORE:", err);
  process.exit(1);
});
