import { NextResponse, type NextRequest } from "next/server";
import { getSession, isMagazzino } from "@/lib/auth";
import { getProdottoByEan, createProdottoStub } from "@/lib/prodottiDb";

export const runtime = "nodejs";

// POST /api/prodotti — crea un prodotto "stub" (titolo+EAN+stock iniziale in
// una sede, nessun prezzo/marca) da uno scan magazzino con EAN sconosciuto —
// sostituisce CreaProdottoWidget (app Flutter), che scriveva direttamente su
// Firestore Prodotti. Gated isMagazzino: chi fa lo scan non è admin.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const ean = typeof body.ean === "string" ? body.ean.trim() : "";
  const titolo = typeof body.titolo === "string" ? body.titolo.trim() : "";
  const quantita = Number(body.quantita);
  const sedeId = typeof body.sedeId === "string" ? body.sedeId : "";
  if (!ean || !titolo) return NextResponse.json({ error: "EAN e titolo obbligatori" }, { status: 400 });
  if (!sedeId) return NextResponse.json({ error: "Sede obbligatoria" }, { status: 400 });
  if (!Number.isFinite(quantita) || quantita < 0) {
    return NextResponse.json({ error: "Quantità non valida" }, { status: 400 });
  }

  try {
    // Mirror del dupe-check originale: EAN + T24=false già esistente.
    const esiste = await getProdottoByEan(ean);
    if (esiste) return NextResponse.json({ error: "Prodotto già esistente", prodotto: esiste }, { status: 409 });

    const prodotto = await createProdottoStub({ ean, titolo, quantita, sedeId });
    return NextResponse.json({ prodotto }, { status: 201 });
  } catch (err) {
    console.error("[api/prodotti POST]", err);
    return NextResponse.json({ error: "Errore nella creazione" }, { status: 500 });
  }
}
