import { NextResponse } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { getMonitoringKpi, getCallsTimeSeries } from "@/lib/tyre24/analisiDb";

export const runtime = "nodejs";

// GET /api/tyre24/monitoraggio — KPI aggregati + serie temporale (30gg)
// delle chiamate all'API prezzi Tyre24 (search vs distributorList, la
// seconda fatturata per chiamata) da b2b.t24_api_log. Tab "Monitoraggio"
// della pagina /admin/tyre24-prezzi.
export async function GET() {
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  try {
    const [kpi, serie] = await Promise.all([getMonitoringKpi(), getCallsTimeSeries()]);
    return NextResponse.json({ kpi, serie });
  } catch (err) {
    console.error("[api/tyre24/monitoraggio GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento monitoraggio" }, { status: 500 });
  }
}
