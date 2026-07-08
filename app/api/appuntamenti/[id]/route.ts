import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM } from "@/lib/auth";
import { getAppuntamento, updateAppuntamento } from "@/lib/appuntamentiDb";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  const appuntamento = await getAppuntamento(id);
  if (!appuntamento) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
  return NextResponse.json({ appuntamento });
}

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
  if (!body.clienteId || !body.sedeId || !body.dataOra) {
    return NextResponse.json({ error: "Cliente, sede e data/ora sono obbligatori" }, { status: 400 });
  }
  try {
    const appuntamento = await updateAppuntamento(id, {
      clienteId: body.clienteId as string,
      sedeId: body.sedeId as string,
      veicoloId: body.veicoloId as string | undefined,
      operatoreId: body.operatoreId as string | undefined,
      dataOra: body.dataOra as string,
      stato: (body.stato as string) ?? "Programmato",
      intervento: body.intervento as string | undefined,
      servizi: body.servizi as never,
      pneumatici: body.pneumatici as never,
      note: body.note as string | undefined,
    });
    if (!appuntamento) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
    return NextResponse.json({ appuntamento });
  } catch (err) {
    console.error("[api/appuntamenti/:id PATCH]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}
