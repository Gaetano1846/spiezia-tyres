// Collezioni supportate dal counter
export type CounterField = "Preventivo" | "FoglioDiLavoro" | "Ordine";

// Migrazione Fase 4: il numero ordine può essere allocato da Postgres invece
// che da Firestore (vedi app/api/counters/next). Finché la vecchia app
// Flutter crea ordini B2B/Vetrina con numerazione propria (casuale, non
// derivata da Counters/{sedeId}), questo flag resta SPENTO — Firestore
// continua ad allocare come sempre, comportamento identico a oggi. Si accende
// solo al cutover, quando Flutter smette di creare ordini.
const ORDINE_BACKEND = process.env.NEXT_PUBLIC_COUNTERS_ORDINE_BACKEND;

// Stesso meccanismo per Preventivo/FoglioDiLavoro, flag separato e
// indipendente da ORDINE_BACKEND (nessun rischio per la numerazione Ordine
// già in produzione). Verificato prima di costruire questo path: nessuno dei
// due campi è mai transitato su Counters/{sedeId} storicamente (0 valori
// osservati su tutte le sedi) — la numerazione storica Preventivo/Foglio
// veniva da un meccanismo del vecchio CRM Flutter esterno a questo doc.
const EXTRA_BACKEND = process.env.NEXT_PUBLIC_COUNTERS_EXTRA_BACKEND;

async function nextCounterPostgres(field: CounterField, sedeId: string): Promise<number> {
  const res = await fetch("/api/counters/next", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field, sedeId }),
  });
  if (!res.ok) throw new Error(`allocazione numero ${field} fallita: ${res.status}`);
  const { numero } = (await res.json()) as { numero: number };
  return numero;
}

// Ramo Firestore (default): SERVER-SIDE via Admin SDK (app/api/counters/next-firestore),
// non più un client `runTransaction`. Le Firestore Security Rules richiedono
// `request.auth != null` — un cliente autenticato solo via Postgres (auth
// VPS-native) non ha un token Firebase Auth, quindi la scrittura diretta dal
// browser falliva sempre con permission-denied (bloccava checkout/preventivi/
// fogli di lavoro). Stesso documento Counters/{sedeId}, stessa garanzia di
// unicità con Flutter — cambia solo da dove parte la scrittura.
async function nextCounterFirestore(field: CounterField, sedeId: string): Promise<number> {
  const res = await fetch("/api/counters/next-firestore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field, sedeId }),
  });
  if (!res.ok) throw new Error(`allocazione numero fallita: ${res.status}`);
  const { numero } = (await res.json()) as { numero: number };
  return numero;
}

/**
 * Restituisce il prossimo numero sequenziale per una collezione e sede.
 *
 * Esempio: nextCounter("Preventivo", "Nola") → 1, 2, 3, ...
 */
export async function nextCounter(
  field: CounterField,
  sedeId: string
): Promise<number> {
  const postgres =
    (field === "Ordine" && ORDINE_BACKEND === "postgres") ||
    (field !== "Ordine" && EXTRA_BACKEND === "postgres");
  if (postgres) return nextCounterPostgres(field, sedeId);
  return nextCounterFirestore(field, sedeId);
}
