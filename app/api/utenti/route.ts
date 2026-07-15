import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { listUtenti } from "@/lib/utentiDb";

export const runtime = "nodejs";

// GET /api/utenti?search=&ruolo=&limit=&offset= — lista paginata utenti
// (admin/clienti). Sostituisce useFirestoreInfiniteList(collectionPath:"users"),
// che leggeva Firestore direttamente dal browser via Firebase Web SDK — ora
// core.utenti è la fonte, stesso pattern di GET /api/clienti (searchClienti).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? undefined;
  const ruolo = searchParams.get("ruolo") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 100, 500);
  const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);

  try {
    const utenti = await listUtenti({ search, ruolo, limit, offset });
    return NextResponse.json({ utenti, hasMore: utenti.length === limit });
  } catch (err) {
    console.error("[api/utenti GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento utenti" }, { status: 500 });
  }
}
