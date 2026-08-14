import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { createAnalisiJob, finishAnalisiJob, listProdottiT24, listRecentJobs } from "@/lib/tyre24/analisiDb";
import { runAnalisiJob, type RunParams } from "@/lib/tyre24/runAnalisi";

// POST /api/tyre24/analisi — avvia un'analisi prezzi Tyre24 sui prodotti
// REALMENTE nostri (public.prodotti WHERE t24=false — t24=true è il
// catalogo esterno Tyre24 mirrorato per riferimento, 152k righe, NON prodotti
// nostri, vedi lib/tyre24/analisiDb.ts). Stesso pattern fire-and-forget
// di startBulkShipmentJob (app/api/gls-italy/route.ts): il container Next.js
// è un processo Node persistente, il lavoro continua dopo la response 202.
// La logica di esecuzione vera e propria vive in lib/tyre24/runAnalisi.ts
// (condivisa con instrumentation.ts, che riprende i job "running" rimasti
// tali dopo un riavvio/deploy — vedi resumeUnfinishedJobs).
// Dati di costo/acquisto: admin-only, coerente con stripProductPrices che
// azzera sempre Prezzo_Acquisto per i ruoli non-admin.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const marca = typeof body.marca === "string" && body.marca !== "" ? body.marca : null;
  const params: RunParams = {
    paese: typeof body.paese === "string" ? body.paese : "it",
    lingua: typeof body.lingua === "string" ? body.lingua : "it",
    marca,
    minStock: Number(body.minStock ?? 4),
    sogliaDeltaPct: Number(body.sogliaDeltaPct ?? 0.5),
    margineFisso: Number(body.margineFisso ?? 6),
    spedizione: Number(body.spedizione ?? 4),
    commissionePct: Number(body.commissionePct ?? 0.015),
    pricingAdvantage: Number(body.pricingAdvantage ?? 0.1),
  };
  const limit = body.limit != null ? Number(body.limit) : undefined;

  const prodotti = await listProdottiT24({ paese: params.paese, marca, limit });

  const jobId = await createAnalisiJob({
    paese: params.paese, lingua: params.lingua, marca, minStock: params.minStock,
    sogliaDeltaPct: params.sogliaDeltaPct, margineFisso: params.margineFisso,
    spedizione: params.spedizione, commissionePct: params.commissionePct,
    pricingAdvantage: params.pricingAdvantage, totale: prodotti.length,
    createdBy: session?.email ?? null,
  });

  runAnalisiJob(jobId, prodotti, params).catch((error: unknown) => {
    console.error(`Tyre24 analisi job ${jobId} crashed:`, error);
    finishAnalisiJob(jobId, {
      stato: "error",
      error: error instanceof Error ? error.message : "Errore sconosciuto",
    }).catch(() => {});
  });

  return NextResponse.json({ success: true, jobId, totale: prodotti.length }, { status: 202 });
}

// GET /api/tyre24/analisi?limit=&offset= — storico job passati (tab
// "Storico" della pagina admin), a differenza di /latest (solo l'ultimo)
// e di resumeUnfinishedJobs (solo i "running", uso interno al boot).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");
  try {
    const { jobs, hasMore } = await listRecentJobs({
      limit: limitParam ? Number(limitParam) : undefined,
      offset: offsetParam ? Number(offsetParam) : undefined,
    });
    return NextResponse.json({ jobs, hasMore });
  } catch (err) {
    console.error("[api/tyre24/analisi GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento storico" }, { status: 500 });
  }
}
