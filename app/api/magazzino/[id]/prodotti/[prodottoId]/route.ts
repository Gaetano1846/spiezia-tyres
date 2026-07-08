import { NextResponse, type NextRequest } from "next/server";
import { getSession, isMagazzino } from "@/lib/auth";
import { removeProdotto } from "@/lib/magazzinoDb";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; prodottoId: string }> }) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id, prodottoId } = await params;
  try {
    const gabbia = await removeProdotto(id, prodottoId);
    if (!gabbia) return NextResponse.json({ error: "Gabbia non trovata" }, { status: 404 });
    return NextResponse.json({ gabbia });
  } catch (err) {
    console.error("[api/magazzino/:id/prodotti/:prodottoId DELETE]", err);
    return NextResponse.json({ error: "Errore nella rimozione" }, { status: 500 });
  }
}
