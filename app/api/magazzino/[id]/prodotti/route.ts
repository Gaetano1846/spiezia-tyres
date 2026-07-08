import { NextResponse, type NextRequest } from "next/server";
import { getSession, isMagazzino } from "@/lib/auth";
import { addProdotto } from "@/lib/magazzinoDb";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const prodottoId = typeof body.prodottoId === "string" ? body.prodottoId : "";
  const quantita = Number(body.quantita);
  if (!prodottoId || !Number.isFinite(quantita) || quantita <= 0) {
    return NextResponse.json({ error: "prodottoId e quantita sono obbligatori" }, { status: 400 });
  }

  try {
    const gabbia = await addProdotto(id, prodottoId, quantita);
    if (!gabbia) return NextResponse.json({ error: "Gabbia non trovata" }, { status: 404 });
    return NextResponse.json({ gabbia });
  } catch (err) {
    console.error("[api/magazzino/:id/prodotti POST]", err);
    return NextResponse.json({ error: "Errore nell'aggiunta" }, { status: 500 });
  }
}
