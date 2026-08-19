import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { getReportAggregato } from "@/lib/ordiniDb";

export const runtime = "nodejs";

// GET /api/admin/report?from=YYYY-MM-DD&to=YYYY-MM-DD&fonti=B2B,eBay
//
// Report aggregato ordini (conteggio, fatturato, valore medio, andamento nel
// tempo, prodotti più venduti) per fonte e periodo. Thin wrapper attorno a
// getReportAggregato (lib/ordiniDb.ts) — l'aggregazione vera gira in SQL su
// core.ordini/core.ordine_articoli, non più su Firestore (il bridge PG↔Firestore
// è stato dismesso col distacco completo da Firebase: leggere Firestore qui
// significava un grafico fermo alla data del distacco, non un bug del grafico
// ma dati a monte semplicemente mai più scritti dopo quel punto).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  const fontiParam = searchParams.get("fonti");

  if (!fromStr || !toStr) {
    return NextResponse.json({ error: "Parametri from/to obbligatori" }, { status: 400 });
  }
  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T23:59:59.999`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return NextResponse.json({ error: "Range date non valido" }, { status: 400 });
  }

  const fonti = fontiParam ? fontiParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  try {
    const report = await getReportAggregato({ from, to, fonti });
    return NextResponse.json(report);
  } catch (err) {
    console.error("[api/admin/report]", err);
    return NextResponse.json({ error: "Errore nel calcolo del report" }, { status: 500 });
  }
}
