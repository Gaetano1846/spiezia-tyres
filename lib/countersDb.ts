// Allocazione contatori (Ordine, ecc.) per chiamanti SERVER-SIDE già dentro
// una Route Handler (checkout, conversione preventivo). NON usare lib/counters.ts
// da qui: quella è la variante client-facing e alloca via fetch("/api/counters/
// next[-firestore]") — un URL relativo non è risolvibile da un Route Handler
// Node (nessuna origin di browser), quindi fallirebbe sempre a runtime.
//
// Stessa semantica/flag di lib/counters.ts, stesso documento Firestore
// Counters/{sedeId} / stessa tabella b2b.counters — la numerazione resta
// unica indipendentemente da dove parte l'allocazione. Import statico di
// firebase-admin/pg qui è sicuro: questo file è importato solo da Route
// Handler (mai da componenti "use client"), quindi non finisce mai nel
// bundle browser — a differenza di lib/counters.ts, che invece è importato
// da pagine client (preventivi/nuova, fogli-di-lavoro/nuovo) e per questo
// deve restare privo di import server-only diretti.

import { getDb } from "@/lib/db";
import { adminDb } from "@/lib/firebase-admin";
import type { CounterField } from "@/lib/counters";

const ORDINE_BACKEND = process.env.NEXT_PUBLIC_COUNTERS_ORDINE_BACKEND;

async function allocateOrdinePostgres(sedeId: string): Promise<number> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const { rows } = await db.query(
    `INSERT INTO b2b.counters (sede_id, campo, valore)
     VALUES ($1, 'Ordine', 100000)
     ON CONFLICT (sede_id, campo) DO UPDATE SET valore = b2b.counters.valore + 1
     RETURNING valore`,
    [sedeId]
  );
  return Number(rows[0].valore);
}

async function allocateFirestore(field: CounterField, sedeId: string): Promise<number> {
  const db = adminDb();
  const counterRef = db.doc(`Counters/${sedeId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists ? ((snap.data() as Record<string, number>)[field] ?? 0) : 0;
    const next = current + 1;
    tx.set(counterRef, { [field]: next }, { merge: true });
    return next;
  });
}

/**
 * Variante server-side di nextCounter() (lib/counters.ts) per l'uso diretto
 * dentro Route Handler già autenticate (checkout/ordine, preventivi/converti
 * verificano la sessione PRIMA di chiamare questa funzione — nessun controllo
 * d'auth qui, a differenza di /api/counters/next[-firestore] che sono
 * endpoint pubblici e quindi verificano getSession() da soli).
 */
export async function nextCounterServer(field: CounterField, sedeId: string): Promise<number> {
  if (field === "Ordine" && ORDINE_BACKEND === "postgres") {
    return allocateOrdinePostgres(sedeId);
  }
  return allocateFirestore(field, sedeId);
}
