import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { getOrdine } from "@/lib/ordiniDb";

export const runtime = "nodejs";

// GET /api/admin/ordini/[id] — dettaglio completo (Articoli + Cronologia + Note_Interne).
// Sostituisce il getDoc Firestore diretto (client SDK) di admin/ordini/[id]/page.tsx.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const ordine = await getOrdine(id);
    if (!ordine) return NextResponse.json({ error: "Ordine non trovato" }, { status: 404 });
    return NextResponse.json({ ordine });
  } catch (err) {
    console.error("[api/admin/ordini/[id] GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento ordine" }, { status: 500 });
  }
}
