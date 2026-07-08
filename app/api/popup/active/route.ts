import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { listActivePopupsForUser } from "@/lib/popupDb";

export const runtime = "nodejs";

// GET /api/popup/active — pop-up attivi non ancora visti dall'utente loggato.
// Sostituisce la query client-side in components/layout/B2BPopUp.tsx.
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  try {
    const popups = await listActivePopupsForUser(session.uid);
    return NextResponse.json({ popups });
  } catch (err) {
    console.error("[api/popup/active GET]", err);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}
