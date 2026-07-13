import { NextResponse, type NextRequest } from "next/server";
import { getSession, isMagazzino } from "@/lib/auth";
import { listGabbie, createGabbia } from "@/lib/magazzinoDb";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  try {
    const sedeId = new URL(req.url).searchParams.get("sedeId") ?? undefined;
    const gabbie = await listGabbie(sedeId);
    return NextResponse.json({ gabbie });
  } catch (err) {
    console.error("[api/magazzino GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const codice = typeof body.codice === "string" ? body.codice.trim().toUpperCase() : "";
  if (!codice) return NextResponse.json({ error: "ID gabbia obbligatorio" }, { status: 400 });
  if (!body.sedeId) return NextResponse.json({ error: "Sede obbligatoria" }, { status: 400 });

  try {
    const gabbia = await createGabbia({
      codice,
      x: Number(body.x) || 0,
      y: Number(body.y) || 0,
      z: Number(body.z) || 0,
      sedeId: body.sedeId as string,
    });
    return NextResponse.json({ gabbia }, { status: 201 });
  } catch (err) {
    console.error("[api/magazzino POST]", err);
    return NextResponse.json({ error: "Errore nella creazione" }, { status: 500 });
  }
}
