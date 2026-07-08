import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { setSpedizioniWarehouse } from "@/lib/spedizioniDb";

export const runtime = "nodejs";

// PATCH /api/spedizioni/warehouse — assegna la sede magazzino a un lotto di
// spedizioni. Unica scrittura di questo dominio cutover: nessuna Cloud
// Function coinvolta (vedi nota in lib/spedizioniDb.ts).
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
  const sedeId = body.sedeId as string | undefined;
  if (ids.length === 0 || !sedeId) {
    return NextResponse.json({ error: "ids e sedeId sono obbligatori" }, { status: 400 });
  }

  try {
    await setSpedizioniWarehouse(ids, sedeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/spedizioni/warehouse PATCH]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}
