import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// POST /api/counters/next {field, sedeId} → {numero}
//
// Contatore su Postgres per la numerazione Ordine/Preventivo/FoglioDiLavoro
// (Fase 4 + estensione decommissioning finale Firebase). Ordine è già in
// produzione (flag NEXT_PUBLIC_COUNTERS_ORDINE_BACKEND). Preventivo/
// FoglioDiLavoro nascono PRONTI dietro un secondo flag indipendente
// (NEXT_PUBLIC_COUNTERS_EXTRA_BACKEND, spento di default) — stesso pattern:
// costruiti e verificabili, ma non attivi finché non si conferma che nessun
// altro scrittore (CRM Flutter legacy, se ancora vivo) tocca questi due campi
// in parallelo.
//
// Seed per campo — margine di sicurezza sopra il massimo storico osservato
// (stesso criterio di Ordine: 100000 sopra il max Flutter 99990). Verificato
// via query diretta su b2b.preventivi/b2b.fogli_di_lavoro prima di scegliere
// questi valori: Nola (unica sede con volume reale) ha max
// Preventivo.numero=120, FoglioDiLavoro.numero=1718. Nessuno dei due campi è
// mai transitato su Counters/{sedeId} Firestore (0 valori osservati su tutte
// le sedi) — la numerazione storica veniva da un meccanismo esterno.
//
// UPSERT atomico in una sola query: se la sede non ha ancora una riga per
// quel campo, l'INSERT la crea al seed; altrimenti ON CONFLICT incrementa
// quella esistente. Nessuna race condition possibile (lock di riga Postgres).
const FIELDS = ["Ordine", "Preventivo", "FoglioDiLavoro"] as const;
type CounterField = (typeof FIELDS)[number];
const SEEDS: Record<CounterField, number> = { Ordine: 100000, Preventivo: 1000, FoglioDiLavoro: 5000 };

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  let body: { field?: string; sedeId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }

  const { field, sedeId } = body;
  if (!field || !FIELDS.includes(field as CounterField)) {
    return NextResponse.json({ error: "Campo non valido" }, { status: 400 });
  }
  if (!sedeId || typeof sedeId !== "string") {
    return NextResponse.json({ error: "sedeId obbligatorio" }, { status: 400 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ error: "Postgres non configurato" }, { status: 500 });

  try {
    const { rows } = await db.query(
      `INSERT INTO b2b.counters (sede_id, campo, valore)
       VALUES ($1, $2, $3)
       ON CONFLICT (sede_id, campo) DO UPDATE SET valore = b2b.counters.valore + 1
       RETURNING valore`,
      [sedeId, field, SEEDS[field as CounterField]]
    );
    return NextResponse.json({ numero: Number(rows[0].valore) });
  } catch (err) {
    console.error("[api/counters/next]", err);
    return NextResponse.json({ error: "Errore nell'allocazione del numero" }, { status: 500 });
  }
}
