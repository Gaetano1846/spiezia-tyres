import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listOrdiniDocumenti } from "@/lib/ordiniDb";

export const runtime = "nodejs";

// GET /api/ordini/documenti — fatture PDF + allegati sugli ordini del cliente
// loggato (tab "Documenti" in account). utenteId sempre dalla sessione.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  try {
    const documenti = await listOrdiniDocumenti(session.uid, 100);
    return NextResponse.json({ documenti });
  } catch (err) {
    console.error("[api/ordini/documenti GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento dei documenti" }, { status: 500 });
  }
}
