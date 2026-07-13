import { NextResponse, type NextRequest } from "next/server";
import { getSession, isMagazzino } from "@/lib/auth";
import { getProdottoByEan } from "@/lib/prodottiDb";

export const runtime = "nodejs";

// GET /api/prodotti/ean?ean=... — lookup puntuale su Postgres (non l'indice
// Meilisearch, che non porta gli stock "Occupato" né garantisce dati live):
// usato dallo scan barcode dell'app Flutter magazzino, dove la decisione di
// quanto aggiungere/rimuovere da una gabbia deve basarsi su numeri esatti.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const ean = new URL(req.url).searchParams.get("ean")?.trim();
  if (!ean) return NextResponse.json({ error: "ean obbligatorio" }, { status: 400 });

  try {
    const prodotto = await getProdottoByEan(ean);
    if (!prodotto) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
    return NextResponse.json({ prodotto });
  } catch (err) {
    console.error("[api/prodotti/ean GET]", err);
    return NextResponse.json({ error: "Errore nella ricerca" }, { status: 500 });
  }
}
