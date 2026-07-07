import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { updateLookup, deleteLookup, type LookupKind } from "@/lib/lookupDb";

export const runtime = "nodejs";

const KINDS = new Set<LookupKind>(["sede", "reparto", "mansione", "servizio", "categoria"]);

function parseKind(raw: string): LookupKind | null {
  return KINDS.has(raw as LookupKind) ? (raw as LookupKind) : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { kind: rawKind, id } = await params;
  const kind = parseKind(rawKind);
  if (!kind) return NextResponse.json({ error: "Tipo non valido" }, { status: 400 });

  let body: { nome?: string; indirizzo?: string; citta?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  if (!body.nome?.trim()) {
    return NextResponse.json({ error: "Il nome è obbligatorio" }, { status: 400 });
  }

  try {
    const item = await updateLookup(kind, id, {
      nome: body.nome.trim(),
      indirizzo: body.indirizzo?.trim(),
      citta: body.citta?.trim(),
    });
    if (!item) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
    return NextResponse.json({ item });
  } catch (err) {
    console.error("[api/lookup/:id PATCH]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { kind: rawKind, id } = await params;
  const kind = parseKind(rawKind);
  if (!kind) return NextResponse.json({ error: "Tipo non valido" }, { status: 400 });

  try {
    await deleteLookup(kind, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/lookup/:id DELETE]", err);
    return NextResponse.json({ error: "Errore nell'eliminazione" }, { status: 500 });
  }
}
