import { NextResponse, type NextRequest } from "next/server";
import { getSession, isMagazzino } from "@/lib/auth";
import { removeProdotto } from "@/lib/magazzinoDb";

export const runtime = "nodejs";

// Body opzionale {quantita} — rimozione parziale (pulsante "-" con quantità
// dell'app magazzino); senza body rimuove l'intero lotto (pulsante "X").
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; prodottoId: string }> }) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id, prodottoId } = await params;

  let quantita: number | undefined;
  const rawBody = await req.text();
  if (rawBody) {
    try {
      const body = JSON.parse(rawBody) as Record<string, unknown>;
      const q = Number(body.quantita);
      if (Number.isFinite(q) && q > 0) quantita = q;
    } catch {
      return NextResponse.json({ error: "Body non valido" }, { status: 400 });
    }
  }

  try {
    const gabbia = await removeProdotto(id, prodottoId, quantita);
    if (!gabbia) return NextResponse.json({ error: "Gabbia non trovata" }, { status: 404 });
    return NextResponse.json({ gabbia });
  } catch (err) {
    console.error("[api/magazzino/:id/prodotti/:prodottoId DELETE]", err);
    return NextResponse.json({ error: "Errore nella rimozione" }, { status: 500 });
  }
}
