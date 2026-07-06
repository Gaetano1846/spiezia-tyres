import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { searchProdottiMeili } from "@/lib/meiliProdotti";
import type { ProdottoHit, SearchProdottiParams } from "@/lib/algolia";
import type { Ruolo } from "@/lib/types";

export const runtime = "nodejs";

// Ruoli staff: gestiscono il catalogo → vedono tutti i prezzi.
// Ruoli cliente: vedono SOLO il prezzo del proprio livello (mai Acquisto/altri tier).
const STAFF_ROLES = new Set<Ruolo>(["Admin", "Magazziniere", "Impiegato", "Rappresentante"]);

function stripPrices(hit: ProdottoHit, ruolo: Ruolo | undefined, crm: boolean): ProdottoHit {
  if ((ruolo && STAFF_ROLES.has(ruolo)) || crm) return hit; // staff: prezzi completi

  // cliente: azzera tutto tranne il prezzo del proprio livello (+ fallback generico)
  const tier =
    ruolo === "Grossista" ? "Prezzo_Grossista" :
    ruolo === "Privato"   ? "Prezzo_Privato" :
    ruolo === "T24"       ? "Prezzo_T24" :
    "Prezzo_Gommista";
  const effettivo = Number(hit[tier as keyof ProdottoHit]) || Number(hit.Prezzo_Gommista) || Number(hit.Prezzo) || 0;
  return {
    ...hit,
    Prezzo: effettivo,
    Prezzo_Gommista: tier === "Prezzo_Gommista" ? effettivo : 0,
    Prezzo_Grossista: tier === "Prezzo_Grossista" ? effettivo : 0,
    Prezzo_Privato: tier === "Prezzo_Privato" ? effettivo : 0,
    Prezzo_T24: tier === "Prezzo_T24" ? effettivo : 0,
    Prezzo_Acquisto: 0, // mai al browser
  };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  let params: SearchProdottiParams;
  try {
    params = (await req.json()) as SearchProdottiParams;
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }

  try {
    // Default: ordina per prezzo crescente lato server (su tutte le pagine).
    // ord_<ruolo> = prezzo effettivo per ruolo (replica il fallback di
    // prezzoPerRuolo) con i prodotti senza prezzo spinti in fondo.
    const dir = params.sortPrezzo ?? "asc";
    const field =
      session.Ruolo === "Grossista" ? "ord_grossista" :
      session.Ruolo === "Privato"   ? "ord_privato" :
      session.Ruolo === "T24"       ? "ord_t24" :
      "ord_gommista"; // Gommista + staff/admin + default
    const sort = [`${field}:${dir}`];

    const result = await searchProdottiMeili(params, sort);
    const hits = result.hits.map((h) => stripPrices(h, session.Ruolo, session.CRM));
    return NextResponse.json({ ...result, hits });
  } catch (err) {
    console.error("[prodotti/search]", err);
    return NextResponse.json({ error: "Ricerca fallita" }, { status: 500 });
  }
}
