import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listOrdini } from "@/lib/ordiniDb";

export const runtime = "nodejs";

// GET /api/ordini — ordini del cliente loggato (self-service). utenteId deriva
// SEMPRE dalla sessione server-side, mai da un parametro client — altrimenti
// un utente potrebbe passare un id arbitrario e vedere ordini altrui.
// Sostituisce la query Firestore diretta (client SDK) di app/(client)/ordini/page.tsx.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  try {
    const ordini = await listOrdini({ utenteId: session.uid, limit: 500 });
    return NextResponse.json({ ordini });
  } catch (err) {
    console.error("[api/ordini GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento ordini" }, { status: 500 });
  }
}
