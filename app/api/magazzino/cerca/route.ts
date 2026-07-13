import { NextResponse, type NextRequest } from "next/server";
import { getSession, isMagazzino } from "@/lib/auth";
import { cercaGabbiePerProdotto } from "@/lib/magazzinoDb";

export const runtime = "nodejs";

// GET /api/magazzino/cerca?prodottoId=... — sostituisce lo scan client-side
// di tutte le gabbie fatto dallo scanner (collection(db,"Magazzino") intera).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const prodottoId = searchParams.get("prodottoId");
  const sedeId = searchParams.get("sedeId");
  if (!prodottoId) return NextResponse.json({ error: "prodottoId obbligatorio" }, { status: 400 });

  try {
    const gabbie = await cercaGabbiePerProdotto(prodottoId, sedeId);
    return NextResponse.json({ gabbie });
  } catch (err) {
    console.error("[api/magazzino/cerca GET]", err);
    return NextResponse.json({ error: "Errore nella ricerca" }, { status: 500 });
  }
}
