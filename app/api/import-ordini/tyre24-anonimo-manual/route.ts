import { NextResponse } from "next/server";
import { verifyInternalSecret } from "@/lib/auth";
import { processOrder } from "@/lib/importers/tyre24Anonimo";

// Recupero manuale ordini T24 Anonimo mancati dal polling standard di
// /common/latestorders (Fase 9 — vedi Gotcha "counter di paginazione T24").
// Riceve il payload ordine COMPLETO (già ottenuto via GET /common/order/{id})
// nel body e lo processa con la stessa logica reale del polling automatico.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!verifyInternalSecret(req)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const body = await req.json();
  const order = body?.order;
  if (!order || typeof order.order !== "string") {
    return NextResponse.json({ success: false, error: "Payload ordine T24 mancante o non valido (atteso { order: {...} })" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "true";

  try {
    const result = await processOrder(order, dryRun);
    return NextResponse.json({ success: true, dryRun, ...result });
  } catch (err) {
    console.error("[import-ordini/tyre24-anonimo-manual]", err);
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
