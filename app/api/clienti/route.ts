import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM } from "@/lib/auth";
import { searchClienti, countClienti } from "@/lib/clientiDb";

export const runtime = "nodejs";

// GET /api/clienti?q=&limit= — lista/ricerca clienti (Postgres, Fase 3 migrazione).
// Sostituisce le query dirette Firestore `collection(db,"Clienti")` sparse in
// ~6 pagine (picker cliente in appuntamenti/fogli-di-lavoro/preventivi/checkout).
// `total` (conteggio pieno, non solo la pagina restituita) è incluso quando non
// si sta filtrando per `q`: alimenta la KPI "Clienti totali" della dashboard CRM,
// che prima usava getCountFromServer() su Firestore.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 200, 500);

  try {
    const clienti = await searchClienti(q, limit);
    const total = q ? undefined : await countClienti();
    return NextResponse.json({ clienti, total });
  } catch (err) {
    console.error("[api/clienti GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento clienti" }, { status: 500 });
  }
}
