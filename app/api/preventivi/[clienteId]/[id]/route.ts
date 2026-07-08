import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM } from "@/lib/auth";
import { getPreventivo, updatePreventivo, updatePreventivoStato, updatePreventivoPdf } from "@/lib/preventiviDb";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ clienteId: string; id: string }> }) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { clienteId, id } = await params;
  const preventivo = await getPreventivo(clienteId, id);
  if (!preventivo) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  return NextResponse.json({ preventivo });
}

// PATCH supporta tre casi d'uso (stessa route, corpi diversi):
//  - { pdfUrl } sola          → pagina stampa, dopo la generazione del PDF
//  - { accettato } sola       → pagina scheda, Accetta/Annulla accettazione
//  - { articoli, note, … }    → pagina modifica, aggiornamento completo
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ clienteId: string; id: string }> }) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { clienteId, id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }

  try {
    if (typeof body.pdfUrl === "string" && body.articoli === undefined) {
      const preventivo = await updatePreventivoPdf(clienteId, id, body.pdfUrl);
      if (!preventivo) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
      return NextResponse.json({ preventivo });
    }

    if (typeof body.accettato === "boolean" && body.articoli === undefined) {
      const preventivo = await updatePreventivoStato(clienteId, id, body.accettato);
      if (!preventivo) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
      return NextResponse.json({ preventivo });
    }

    const preventivo = await updatePreventivo(clienteId, id, {
      articoli: (body.articoli as never) ?? [],
      note: (body.note as string) ?? null,
      accettato: Boolean(body.accettato),
      extra: (body.extra as Record<string, unknown>) ?? {},
    });
    if (!preventivo) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
    return NextResponse.json({ preventivo });
  } catch (err) {
    console.error("[api/preventivi/:clienteId/:id PATCH]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}
