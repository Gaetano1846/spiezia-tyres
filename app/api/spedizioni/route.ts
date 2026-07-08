import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { listSpedizioni } from "@/lib/spedizioniDb";

export const runtime = "nodejs";

// GET /api/spedizioni?da=YYYY-MM-DD&a=YYYY-MM-DD — sostituisce l'onSnapshot
// Firestore filtrato per intervallo data (stesso LIST_LIMIT di sicurezza).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const da = searchParams.get("da");
  const a = searchParams.get("a");
  if (!da || !a) return NextResponse.json({ error: "Intervallo date obbligatorio" }, { status: 400 });

  try {
    const { rows, capped } = await listSpedizioni(`${da}T00:00:00`, `${a}T23:59:59.999`);
    return NextResponse.json({ spedizioni: rows, capped });
  } catch (err) {
    console.error("[api/spedizioni GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento" }, { status: 500 });
  }
}
