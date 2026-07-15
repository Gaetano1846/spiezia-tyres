import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM } from "@/lib/auth";
import { listFogli, createFoglio } from "@/lib/fogliDb";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const clienteId = searchParams.get("clienteId") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 300, 1000);
  try {
    const fogli = await listFogli({ limit, clienteId });
    return NextResponse.json({ fogli });
  } catch (err) {
    console.error("[api/fogli-di-lavoro GET]", err);
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
  if (!body.clienteId || !body.sedeId) {
    return NextResponse.json({ error: "Cliente e sede sono obbligatori" }, { status: 400 });
  }
  try {
    const foglio = await createFoglio({
      clienteId: body.clienteId as string,
      sedeId: body.sedeId as string,
      veicoloId: body.veicoloId as string | undefined,
      operatoreId: body.operatoreId as string | undefined,
      numero: body.numero as number | undefined,
      stato: (body.stato as string) ?? "Aperto",
      pneumaticiMontati: body.pneumaticiMontati as never,
      pneumaticiSmontati: body.pneumaticiSmontati as never,
      note: body.note as string | undefined,
    });
    return NextResponse.json({ foglio }, { status: 201 });
  } catch (err) {
    console.error("[api/fogli-di-lavoro POST]", err);
    return NextResponse.json({ error: "Errore nella creazione" }, { status: 500 });
  }
}
