import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateIndirizzoUtente, deleteIndirizzoUtente } from "@/lib/utentiIndirizziDb";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body?.Via?.trim() || !body?.Citta?.trim()) {
    return NextResponse.json({ error: "Via e Città sono obbligatori" }, { status: 400 });
  }

  const ok = await updateIndirizzoUtente(session.uid, id, body);
  if (!ok) return NextResponse.json({ error: "Indirizzo non trovato" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id } = await params;

  const ok = await deleteIndirizzoUtente(session.uid, id);
  if (!ok) return NextResponse.json({ error: "Indirizzo non trovato" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
