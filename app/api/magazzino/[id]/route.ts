import { NextResponse, type NextRequest } from "next/server";
import { getSession, isMagazzino } from "@/lib/auth";
import { getGabbia, updateGabbiaPosizione } from "@/lib/magazzinoDb";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  const gabbia = await getGabbia(id);
  if (!gabbia) return NextResponse.json({ error: "Non trovata" }, { status: 404 });
  return NextResponse.json({ gabbia });
}

// PATCH {x,y,z} — riposizionamento gabbia (Modifica Gabbia/Posizione, app Flutter magazzino).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  let body: { x?: unknown; y?: unknown; z?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const x = Number(body.x);
  const y = Number(body.y);
  const z = Number(body.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return NextResponse.json({ error: "x, y, z devono essere numerici" }, { status: 400 });
  }
  try {
    const gabbia = await updateGabbiaPosizione(id, { x, y, z });
    if (!gabbia) return NextResponse.json({ error: "Non trovata" }, { status: 404 });
    return NextResponse.json({ gabbia });
  } catch (err) {
    console.error("[api/magazzino/[id] PATCH]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}
