import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

// POST /api/counters/next-firestore {field, sedeId} → {numero}
//
// Allocazione contatori Preventivo/FoglioDiLavoro/Ordine (ramo Firestore,
// default finché ORDINE_BACKEND non passa a Postgres — vedi lib/counters.ts)
// SERVER-SIDE via Admin SDK. Stessa transazione monotona che prima girava
// client-side con `runTransaction` del client SDK: le Firestore Security
// Rules richiedono `request.auth != null`, che un cliente autenticato solo
// via Postgres (auth VPS-native) non ha — la scrittura diretta dal browser
// falliva sempre con permission-denied. L'Admin SDK bypassa le rules, quindi
// b2b2 e il CRM Flutter continuano a serializzare sullo stesso documento
// Counters/{sedeId}, zero collisioni, ma la scrittura parte dal server.

const FIELDS = ["Preventivo", "FoglioDiLavoro", "Ordine"] as const;
type CounterField = (typeof FIELDS)[number];

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

  try {
    const db = adminDb();
    const counterRef = db.doc(`Counters/${sedeId}`);
    const numero = await db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists ? ((snap.data() as Record<string, number>)[field] ?? 0) : 0;
      const next = current + 1;
      tx.set(counterRef, { [field]: next }, { merge: true });
      return next;
    });
    return NextResponse.json({ numero });
  } catch (err) {
    console.error("[api/counters/next-firestore]", err);
    return NextResponse.json({ error: "Errore nell'allocazione del numero" }, { status: 500 });
  }
}
