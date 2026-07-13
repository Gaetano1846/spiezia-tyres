import { NextResponse, type NextRequest } from "next/server";
import { getSession, isMagazzino } from "@/lib/auth";
import { getOrdine } from "@/lib/ordiniDb";

export const runtime = "nodejs";

// GET /api/magazzino/ordini/[id] — dettaglio ordine per l'operatore di
// magazzino (screen Ordini/Old_Ordini dell'app Flutter). Distinto da
// /api/ordini/[id] (self-service, richiede ownership o admin/CRM) e da
// /api/admin/ordini/[id] (isAdmin-only): il personale di magazzino non è
// né proprietario né admin.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const ordine = await getOrdine(id);
    if (!ordine) return NextResponse.json({ error: "Ordine non trovato" }, { status: 404 });
    return NextResponse.json({ ordine });
  } catch (err) {
    console.error("[api/magazzino/ordini/[id] GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento ordine" }, { status: 500 });
  }
}
