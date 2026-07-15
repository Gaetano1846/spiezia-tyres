import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getProdottoById, stripProductPrices } from "@/lib/prodottiDb";

export const runtime = "nodejs";

// GET /api/prodotti/:id/pubblico — dettaglio prodotto per lo storefront
// (scheda prodotto/carrello), a differenza di /api/prodotti/:id che è gated
// isMagazzino. Qui basta essere autenticati (stesso requisito minimo di
// /api/prodotti/search); i prezzi sono filtrati per ruolo con la stessa
// logica del search, mai esporre Prezzo_Acquisto al browser cliente.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id } = await params;
  try {
    const prodotto = await getProdottoById(id);
    if (!prodotto) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
    return NextResponse.json({ prodotto: stripProductPrices(prodotto, session.Ruolo, session.CRM) });
  } catch (err) {
    console.error("[api/prodotti/:id/pubblico GET]", err);
    return NextResponse.json({ error: "Errore nella ricerca" }, { status: 500 });
  }
}
