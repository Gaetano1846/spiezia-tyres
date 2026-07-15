import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getProdottiByIds, stripProductPrices } from "@/lib/prodottiDb";

export const runtime = "nodejs";

// POST /api/prodotti/batch { ids: string[] } — lookup batch per il carrello
// (controllo stock/prezzo live) e per l'hydration della ricerca prodotti,
// entrambi lato storefront: stesso requisito minimo di autenticazione e
// stesso filtro prezzi per ruolo di /api/prodotti/:id/pubblico.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  let ids: unknown;
  try {
    ({ ids } = await req.json());
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "ids deve essere un array di stringhe" }, { status: 400 });
  }

  try {
    const prodotti = await getProdottiByIds(ids);
    return NextResponse.json({
      prodotti: prodotti.map((p) => stripProductPrices(p, session.Ruolo, session.CRM)),
    });
  } catch (err) {
    console.error("[api/prodotti/batch POST]", err);
    return NextResponse.json({ error: "Errore nella ricerca" }, { status: 500 });
  }
}
