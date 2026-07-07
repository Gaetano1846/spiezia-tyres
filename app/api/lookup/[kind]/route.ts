import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { listLookup, createLookup, type LookupKind } from "@/lib/lookupDb";

export const runtime = "nodejs";

const KINDS = new Set<LookupKind>(["sede", "reparto", "mansione", "servizio", "categoria"]);

function parseKind(raw: string): LookupKind | null {
  return KINDS.has(raw as LookupKind) ? (raw as LookupKind) : null;
}

// GET/POST /api/lookup/:kind — Sede/Reparto/Mansione/Servizi/Categoria_Prodotti
// (Fase 6: sostituisce collection(db,"Sede"|"Reparto"|"Mansione"|"Servizi"|
// "Categoria_Prodotti") in admin/sedi e admin/catalogo. Il bridge propaga le
// scritture a Firestore per il CRM FlutterFlow legacy.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const kind = parseKind((await params).kind);
  if (!kind) return NextResponse.json({ error: "Tipo non valido" }, { status: 400 });

  try {
    const items = await listLookup(kind);
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[api/lookup GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const kind = parseKind((await params).kind);
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
    const item = await createLookup(kind, {
      nome: body.nome.trim(),
      indirizzo: body.indirizzo?.trim(),
      citta: body.citta?.trim(),
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    console.error("[api/lookup POST]", err);
    return NextResponse.json({ error: "Errore nella creazione" }, { status: 500 });
  }
}
