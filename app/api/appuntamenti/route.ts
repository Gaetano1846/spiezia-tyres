import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM } from "@/lib/auth";
import { listAppuntamenti, createAppuntamento } from "@/lib/appuntamentiDb";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  try {
    const appuntamenti = await listAppuntamenti(200);
    return NextResponse.json({ appuntamenti });
  } catch (err) {
    console.error("[api/appuntamenti GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
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
    const appuntamento = await createAppuntamento({
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
    return NextResponse.json({ appuntamento }, { status: 201 });
  } catch (err) {
    console.error("[api/appuntamenti POST]", err);
    return NextResponse.json({ error: "Errore nella creazione" }, { status: 500 });
  }
}
