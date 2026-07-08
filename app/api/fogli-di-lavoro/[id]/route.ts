import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM } from "@/lib/auth";
import { getFoglio, updateFoglio, updateFoglioStato, updateFoglioPdf } from "@/lib/fogliDb";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  const foglio = await getFoglio(id);
  if (!foglio) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  return NextResponse.json({ foglio });
}

// PATCH supporta tre casi d'uso (stessa route, corpi diversi):
//  - { pdfUrl } sola          → pagina stampa, dopo la generazione del PDF
//  - { stato } sola           → pagina scheda, avanzamento stato rapido
//  - { clienteId, sedeId, … } → pagina modifica, aggiornamento completo
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }

  try {
    if (typeof body.pdfUrl === "string" && !body.clienteId) {
      const foglio = await updateFoglioPdf(id, body.pdfUrl);
      if (!foglio) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
      return NextResponse.json({ foglio });
    }

    if (typeof body.stato === "string" && !body.clienteId) {
      const foglio = await updateFoglioStato(id, body.stato);
      if (!foglio) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
      return NextResponse.json({ foglio });
    }

    if (!body.clienteId || !body.sedeId) {
      return NextResponse.json({ error: "Cliente e sede sono obbligatori" }, { status: 400 });
    }
    const foglio = await updateFoglio(id, {
      clienteId: body.clienteId as string,
      sedeId: body.sedeId as string,
      veicoloId: body.veicoloId as string | undefined,
      stato: body.stato as string | undefined,
      pneumaticiMontati: body.pneumaticiMontati as never,
      pneumaticiSmontati: body.pneumaticiSmontati as never,
      note: body.note as string | undefined,
    });
    if (!foglio) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
    return NextResponse.json({ foglio });
  } catch (err) {
    console.error("[api/fogli-di-lavoro/:id PATCH]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}
