import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { getSpedizioniKpi } from "@/lib/spedizioniDb";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  try {
    const kpi = await getSpedizioniKpi();
    return NextResponse.json({ kpi });
  } catch (err) {
    console.error("[api/spedizioni/kpi GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento" }, { status: 500 });
  }
}
