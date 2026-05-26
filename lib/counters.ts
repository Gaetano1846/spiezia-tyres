import { db } from "@/lib/firebase";
import { doc, runTransaction } from "firebase/firestore";

// Collezioni supportate dal counter
export type CounterField = "Preventivo" | "FoglioDiLavoro" | "Ordine";

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
