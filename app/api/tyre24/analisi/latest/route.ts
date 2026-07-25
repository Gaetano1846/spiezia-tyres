import { NextResponse } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { getLatestJob } from "@/lib/tyre24/analisiDb";

export const runtime = "nodejs";

// GET /api/tyre24/analisi/latest — job più recente (in corso, o l'ultimo
// concluso). Usato dalla pagina admin per ritrovare un'analisi in corso
// anche aprendo la pagina da un browser/sessione diversi da chi l'ha
// avviata — il localStorage locale (vedi page.tsx) è solo un fast-path.
export async function GET() {
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  try {
    const job = await getLatestJob();
    return NextResponse.json({ job });
  } catch (err) {
    console.error("[api/tyre24/analisi/latest GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento" }, { status: 500 });
  }
}
