import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM } from "@/lib/auth";
import { listPromemoria, createPromemoria } from "@/lib/promemoriaDb";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const clienteId = searchParams.get("clienteId") ?? undefined;
  const completataParam = searchParams.get("completata");
  const completata = completataParam === "true" ? true : completataParam === "false" ? false : undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 1000);
  try {
    const promemoria = await listPromemoria({ limit, clienteId, completata });
    return NextResponse.json({ promemoria });
  } catch (err) {
    console.error("[api/promemoria GET]", err);
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
  if (!body.clienteId || !(body.nome as string | undefined)?.toString().trim()) {
    return NextResponse.json({ error: "Cliente e nome sono obbligatori" }, { status: 400 });
  }
  try {
    const promemoria = await createPromemoria({
      clienteId: body.clienteId as string,
      nome: (body.nome as string).toString().trim(),
      descrizione: (body.descrizione as string | null | undefined) ?? null,
      dataScadenza: (body.dataScadenza as string | null | undefined) ?? null,
      utenteId: session.uid,
    });
    return NextResponse.json({ promemoria }, { status: 201 });
  } catch (err) {
    console.error("[api/promemoria POST]", err);
    return NextResponse.json({ error: "Errore nella creazione" }, { status: 500 });
  }
}
