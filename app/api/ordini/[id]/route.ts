import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin, isCRM } from "@/lib/auth";
import { getOrdine } from "@/lib/ordiniDb";

export const runtime = "nodejs";

// GET /api/ordini/[id] — dettaglio ordine self-service (cliente proprietario,
// o Admin/CRM). Il rappresentante usa /api/rappresentante/ordini/[id] (già
// server-side, verifica l'assegnazione cliente). Sostituisce il getDoc
// Firestore diretto — qui l'ownership va verificata a mano (niente Security
// Rules lato Postgres) prima di restituire l'ordine.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id } = await params;
  try {
    const ordine = await getOrdine(id);
    if (!ordine) return NextResponse.json({ error: "Ordine non trovato" }, { status: 404 });

    const owner = ordine.UtenteId === session.uid;
    if (!owner && !isAdmin(session) && !isCRM(session)) {
      return NextResponse.json({ error: "Ordine non trovato" }, { status: 404 });
    }

    return NextResponse.json({ ordine });
  } catch (err) {
    console.error("[api/ordini/[id] GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento ordine" }, { status: 500 });
  }
}
