import { NextResponse } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { listMarcheProdotti } from "@/lib/tyre24/analisiDb";

export const runtime = "nodejs";

// GET /api/tyre24/marche — marche distinte tra i prodotti nostri (t24=false),
// alimenta il dropdown filtro marca della pagina /admin/tyre24-prezzi.
export async function GET() {
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  try {
    const marche = await listMarcheProdotti();
    return NextResponse.json({ marche });
  } catch (err) {
    console.error("[api/tyre24/marche GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento marche" }, { status: 500 });
  }
}
