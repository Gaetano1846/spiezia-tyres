import { NextResponse, type NextRequest } from "next/server";
import { getSession, isMagazzino } from "@/lib/auth";
import { getProdottoById } from "@/lib/prodottiDb";

export const runtime = "nodejs";

// GET /api/prodotti/:id — dettaglio pieno (Postgres, non l'indice di ricerca)
// per un prodotto già identificato altrove (screen Magazzino/Gabbia: card
// dentro/fuori gabbia, che prima leggevano un DocumentReference Firestore
// diretto). Gated isMagazzino, non isAdmin: usato dal personale di magazzino.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const prodotto = await getProdottoById(id);
    if (!prodotto) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
    return NextResponse.json({ prodotto });
  } catch (err) {
    console.error("[api/prodotti/:id GET]", err);
    return NextResponse.json({ error: "Errore nella ricerca" }, { status: 500 });
  }
}
