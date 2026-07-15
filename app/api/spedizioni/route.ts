import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { listSpedizioni, listSpedizioniByOrdine } from "@/lib/spedizioniDb";

export const runtime = "nodejs";

// GET /api/spedizioni?da=YYYY-MM-DD&a=YYYY-MM-DD — sostituisce l'onSnapshot
// Firestore filtrato per intervallo data (stesso LIST_LIMIT di sicurezza).
// GET /api/spedizioni?ordineId=xxx — spedizioni di UN ordine (modale
// "Spedizioni" nella lista ordini admin), interrogato via polling periodico
// mentre il modale è aperto invece del vecchio onSnapshot realtime.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const ordineId = searchParams.get("ordineId");
  if (ordineId) {
    try {
      const spedizioni = await listSpedizioniByOrdine(ordineId);
      return NextResponse.json({ spedizioni });
    } catch (err) {
      console.error("[api/spedizioni GET ordineId]", err);
      return NextResponse.json({ error: "Errore nel caricamento" }, { status: 500 });
    }
  }

  const da = searchParams.get("da");
  const a = searchParams.get("a");
  if (!da || !a) return NextResponse.json({ error: "Intervallo date o ordineId obbligatorio" }, { status: 400 });

  try {
    const { rows, capped } = await listSpedizioni(`${da}T00:00:00`, `${a}T23:59:59.999`);
    return NextResponse.json({ spedizioni: rows, capped });
  } catch (err) {
    console.error("[api/spedizioni GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento" }, { status: 500 });
  }
}
