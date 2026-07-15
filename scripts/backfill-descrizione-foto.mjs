// One-off: legge SKU + Descrizione + Foto da Firestore Prodotti (T24=false)
// e li scrive su public.prodotti.descrizione/foto (Spiezia-DB/migrations/026)
// — stesso pattern di backfill-categoria-adtyres.mjs (022/024/025).
// Pensato per girare DENTRO un container ad-hoc dalla stessa immagine
// (il container di produzione ha rootfs read-only):
//   docker compose -p spiezia-b2b2 -f docker-compose.yml run --rm --no-deps \
//     -v scripts/backfill-descrizione-foto.mjs:/app/backfill-descrizione-foto.mjs:ro \
//     -e DATABASE_URL="postgresql://prezzo:<pw>@postgres:5432/prezzo" \
//     --entrypoint "node backfill-descrizione-foto.mjs" spiezia-b2b2

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
    const descrizione = typeof data.Descrizione === "string" ? data.Descrizione.trim() : "";
    const foto = typeof data.Foto === "string" ? data.Foto.trim() : "";
    if (sku && (descrizione || foto)) {
      rows.push([sku, descrizione || null, foto || null]);
    }
  });
  console.log(`[backfill] ${rows.length} righe con SKU e almeno uno tra Descrizione/Foto valorizzati.`);

  let totalMatched = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const placeholders = chunk.map(([sku, descrizione, foto], idx) => {
      values.push(sku, descrizione, foto);
      return `($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3})`;
    });
    const { rowCount } = await pool.query(
      `UPDATE public.prodotti AS p SET descrizione = v.descrizione, foto = v.foto
       FROM (VALUES ${placeholders.join(", ")}) AS v(sku, descrizione, foto)
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
