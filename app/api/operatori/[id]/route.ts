import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { updateOperatore } from "@/lib/operatoriDb";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  try {
    // sedeId/mansioneId/repartoId sono assegnati direttamente (non merge parziale):
    // il chiamante deve sempre inviare lo stato pieno del form ("" → null per "nessuno").
    const operatore = await updateOperatore(id, {
      displayName: body.displayName as string | undefined,
      ruolo: body.ruolo as string | undefined,
      sedeId: (body.sedeId as string) || null,
      mansioneId: (body.mansioneId as string) || null,
      repartoId: (body.repartoId as string) || null,
    });
    if (!operatore) return NextResponse.json({ error: "Operatore non trovato" }, { status: 404 });
    return NextResponse.json({ operatore });
  } catch (err) {
    console.error("[api/operatori/:id PATCH]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}
