import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { listEmails } from "@/lib/emailsDb";

export const runtime = "nodejs";

// GET /api/emails?direzione=&tipologia=&risposto=&search=&limit= — lista
// email (admin/email). Sostituisce la query Firestore diretta dal browser
// (collection(db,"Emails")) — ora b2b.emails è la fonte.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const direzione = searchParams.get("direzione") ?? undefined;
  const tipologia = searchParams.get("tipologia") ?? undefined;
  const search = searchParams.get("search") ?? undefined;
  const rispostoParam = searchParams.get("risposto");
  const risposto = rispostoParam === null ? undefined : rispostoParam === "true";
  const limit = Math.min(Number(searchParams.get("limit")) || 200, 500);

  try {
    const emails = await listEmails({ direzione, tipologia, risposto, search, limit });
    return NextResponse.json({ emails });
  } catch (err) {
    console.error("[api/emails GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento email" }, { status: 500 });
  }
}
