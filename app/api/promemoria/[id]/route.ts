import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM } from "@/lib/auth";
import { updatePromemoriaCompletata, deletePromemoria } from "@/lib/promemoriaDb";

export const runtime = "nodejs";

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
  if (typeof body.completata !== "boolean") {
    return NextResponse.json({ error: "completata (boolean) obbligatorio" }, { status: 400 });
  }
  try {
    const ok = await updatePromemoriaCompletata(id, body.completata);
    if (!ok) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/promemoria/:id PATCH]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const ok = await deletePromemoria(id);
    if (!ok) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/promemoria/:id DELETE]", err);
    return NextResponse.json({ error: "Errore nell'eliminazione" }, { status: 500 });
  }
}
