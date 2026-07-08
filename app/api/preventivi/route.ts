import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM } from "@/lib/auth";
import { listPreventivi, createPreventivo } from "@/lib/preventiviDb";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  try {
    const preventivi = await listPreventivi(200);
    return NextResponse.json({ preventivi });
  } catch (err) {
    console.error("[api/preventivi GET]", err);
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
  if (!body.clienteId || !body.numero || !body.data) {
    return NextResponse.json({ error: "Cliente, numero e data sono obbligatori" }, { status: 400 });
  }

  try {
    const preventivo = await createPreventivo({
      clienteId: body.clienteId as string,
      sedeId: body.sedeId as string | undefined,
      operatoreId: body.operatoreId as string | undefined,
      veicoloId: body.veicoloId as string | undefined,
      numero: body.numero as number,
      data: body.data as string,
      articoli: (body.articoli as never) ?? [],
      note: body.note as string | undefined,
    });
    return NextResponse.json({ preventivo }, { status: 201 });
  } catch (err) {
    console.error("[api/preventivi POST]", err);
    return NextResponse.json({ error: "Errore nella creazione" }, { status: 500 });
  }
}
