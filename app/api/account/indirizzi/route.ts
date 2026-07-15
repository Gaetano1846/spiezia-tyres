import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listIndirizziUtente, createIndirizzoUtente, type IndirizzoTipo } from "@/lib/utentiIndirizziDb";

export const runtime = "nodejs";

function parseTipo(v: string | null): IndirizzoTipo | null {
  return v === "fatturazione" || v === "spedizione" ? v : null;
}

// GET /api/account/indirizzi?tipo=fatturazione|spedizione — rubrica
// indirizzi self-service dell'utente autenticato (core.utenti_indirizzi).
// Sostituisce users/{uid}/Indirizzo_Fatturazione|Indirizzo_Spedizione.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const tipo = parseTipo(req.nextUrl.searchParams.get("tipo"));
  if (!tipo) return NextResponse.json({ error: "tipo obbligatorio (fatturazione|spedizione)" }, { status: 400 });

  const indirizzi = await listIndirizziUtente(session.uid, tipo);
  return NextResponse.json({ indirizzi });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const tipo = parseTipo(body?.tipo ?? null);
  if (!tipo) return NextResponse.json({ error: "tipo obbligatorio (fatturazione|spedizione)" }, { status: 400 });
  if (!body?.Via?.trim() || !body?.Citta?.trim()) {
    return NextResponse.json({ error: "Via e Città sono obbligatori" }, { status: 400 });
  }

  const indirizzo = await createIndirizzoUtente(session.uid, tipo, body);
  return NextResponse.json({ indirizzo }, { status: 201 });
}
