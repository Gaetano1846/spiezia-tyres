import { db } from "@/lib/firebase";
import { doc, runTransaction } from "firebase/firestore";

// Collezioni supportate dal counter
export type CounterField = "Preventivo" | "FoglioDiLavoro" | "Ordine";

// Migrazione Fase 4: il numero ordine può essere allocato da Postgres invece
// che da Firestore (vedi app/api/counters/next). Finché la vecchia app
// Flutter crea ordini B2B/Vetrina con numerazione propria (casuale, non
// derivata da Counters/{sedeId}), questo flag resta SPENTO — Firestore
// continua ad allocare come sempre, comportamento identico a oggi. Si accende
// solo al cutover, quando Flutter smette di creare ordini.
// Solo "Ordine" è affetto: Preventivo/FoglioDiLavoro restano sempre Firestore.
const ORDINE_BACKEND = process.env.NEXT_PUBLIC_COUNTERS_ORDINE_BACKEND;

async function nextCounterPostgres(sedeId: string): Promise<number> {
  const res = await fetch("/api/counters/next", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field: "Ordine", sedeId }),
  });
  if (!res.ok) throw new Error(`allocazione numero ordine fallita: ${res.status}`);
  const { numero } = (await res.json()) as { numero: number };
  return numero;
}

/**
 * Restituisce il prossimo numero sequenziale per una collezione e sede.
 * Usa una transaction Firestore per garantire unicità anche con richieste concorrenti.
 *
 * Esempio: nextCounter("Preventivo", "Nola") → 1, 2, 3, ...
 */
export async function nextCounter(
  field: CounterField,
  sedeId: string
): Promise<number> {
  if (field === "Ordine" && ORDINE_BACKEND === "postgres") {
    return nextCounterPostgres(sedeId);
  }

  const counterRef = doc(db, "Counters", sedeId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current: number = snap.exists() ? ((snap.data() as Record<string, number>)[field] ?? 0) : 0;
    const next = current + 1;
    tx.set(counterRef, { [field]: next }, { merge: true });
    return next;
  });
}

/**
 * Legge il counter corrente senza incrementare (utile per visualizzazione).
 */
export async function peekCounter(
  field: CounterField,
  sedeId: string
): Promise<number> {
  const { getDoc } = await import("firebase/firestore");
  const snap = await getDoc(doc(db, "Counters", sedeId));
  if (!snap.exists()) return 0;
  return ((snap.data() as Record<string, number>)[field] ?? 0);
}
