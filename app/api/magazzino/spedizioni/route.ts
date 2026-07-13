import { NextResponse, type NextRequest } from "next/server";
import { getSession, isMagazzino } from "@/lib/auth";
import { listSpedizioniPerSede } from "@/lib/spedizioniDb";

export const runtime = "nodejs";

// GET /api/magazzino/spedizioni?sedeId=&status= — sostituisce
// querySpedizioniRecord (app Flutter, screen Ordini/Old_Ordini) filtrato per
// warehouseSede. Gated isMagazzino: il personale di magazzino non è admin.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const sedeId = searchParams.get("sedeId");
  const status = searchParams.get("status") ?? undefined;
  if (!sedeId) return NextResponse.json({ error: "sedeId obbligatorio" }, { status: 400 });

  try {
    const spedizioni = await listSpedizioniPerSede(sedeId, status);
    return NextResponse.json({ spedizioni });
  } catch (err) {
    console.error("[api/magazzino/spedizioni GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento" }, { status: 500 });
  }
}
