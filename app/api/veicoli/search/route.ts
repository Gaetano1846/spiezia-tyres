import { NextResponse, type NextRequest } from "next/server";
import { getSession, isMagazzino } from "@/lib/auth";
import { searchVeicoloByTarga } from "@/lib/clientiDb";

export const runtime = "nodejs";

// GET /api/veicoli/search?targa=... — ricerca cross-cliente per targa.
// Sostituisce collectionGroup(db,"Veicolo").where("Targa","==",t) nello scanner
// magazzino (era l'unica query cross-tenant reale del dominio Clienti).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const targa = new URL(req.url).searchParams.get("targa")?.trim();
  if (!targa) return NextResponse.json({ error: "Parametro targa mancante" }, { status: 400 });

  try {
    const veicoli = await searchVeicoloByTarga(targa);
    return NextResponse.json({ veicoli });
  } catch (err) {
    console.error("[api/veicoli/search]", err);
    return NextResponse.json({ error: "Ricerca fallita" }, { status: 500 });
  }
}
