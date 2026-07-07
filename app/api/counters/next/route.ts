import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// POST /api/counters/next {field, sedeId} → {numero}
//
// Contatore su Postgres per la numerazione ordini (Fase 4 migrazione). Nasce
// PRONTO ma NON collegato al checkout: la vecchia app Flutter crea ancora
// ordini B2B/Vetrina oggi assegnando numeri IN MODO CASUALE (non da questo
// meccanismo) — finché Flutter non viene dismessa, questa route esiste ma
// lib/counters.ts non la chiama (flag NEXT_PUBLIC_COUNTERS_ORDINE_BACKEND
// spento di default). Al cutover, il flag si accende e questa route diventa
// l'unico allocatore.
//
// Seed: b2b.counters parte da 100000 per ogni sede (sopra il massimo storico
// osservato tra i numeri "B2B" casuali di Flutter, 99990) — zero possibilità
// di collisione con lo storico. Solo campo 'Ordine' è servito da qui:
// Preventivo/FoglioDiLavoro restano sul meccanismo Firestore esistente,
// fuori scope per questa fase.
//
// UPSERT atomico in una sola query: se la sede non ha ancora una riga,
// l'INSERT la crea a 100000; altrimenti ON CONFLICT incrementa quella
// esistente. Nessuna race condition possibile (lock di riga Postgres).
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
  if (field !== "Ordine") {
    return NextResponse.json(
      { error: "Solo il campo 'Ordine' è servito da Postgres in questa fase" },
      { status: 400 }
    );
  }
  if (!sedeId || typeof sedeId !== "string") {
    return NextResponse.json({ error: "sedeId obbligatorio" }, { status: 400 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ error: "Postgres non configurato" }, { status: 500 });

  try {
    const { rows } = await db.query(
      `INSERT INTO b2b.counters (sede_id, campo, valore)
       VALUES ($1, 'Ordine', 100000)
       ON CONFLICT (sede_id, campo) DO UPDATE SET valore = b2b.counters.valore + 1
       RETURNING valore`,
      [sedeId]
    );
    return NextResponse.json({ numero: Number(rows[0].valore) });
  } catch (err) {
    console.error("[api/counters/next]", err);
    return NextResponse.json({ error: "Errore nell'allocazione del numero" }, { status: 500 });
  }
}
