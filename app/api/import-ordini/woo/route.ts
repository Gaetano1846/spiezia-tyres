import { NextResponse } from "next/server";
import { verifyInternalSecret, verifyWooWebhookSignature } from "@/lib/auth";
import { runWooImport } from "@/lib/importers/woo";
import { startImportJob, finishImportJob, failImportJob } from "@/lib/importers/jobLog";

// Sostituto interno della Cloud Function `importWooOrders` (Fase 9). Doppio
// modo di chiamata:
//  - Webhook WooCommerce reale (registrato IN AGGIUNTA a quello verso GCP,
//    non in sostituzione, durante la finestra di verifica) — payload ordine
//    completo, autenticato via firma HMAC X-WC-Webhook-Signature.
//  - Trigger manuale/test — { orderId } o nessun body, autenticato via
//    header x-internal-secret (stesso meccanismo delle altre 3 route).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-wc-webhook-signature");
  const isWooWebhook = verifyWooWebhookSignature(rawBody, signature);

  if (!isWooWebhook && !verifyInternalSecret(req)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  let payload: Record<string, unknown> = {};
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
    }
  }

  const hasFullOrder = typeof payload.id !== "undefined" && typeof payload.billing !== "undefined";
  const orderId = typeof payload.order_id === "number" || typeof payload.order_id === "string" ? payload.order_id : undefined;

  if (!hasFullOrder && !orderId) {
    // WooCommerce test delivery / ping — 200 così il webhook non viene disattivato per failure_count.
    return NextResponse.json({ success: true, message: "Skipped: unrecognized payload (test delivery?)" });
  }

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "true";

  const jobRef = await startImportJob("woo", { dryRun });
  try {
    const result = hasFullOrder ? await runWooImport({ wcOrder: payload, dryRun }) : await runWooImport({ orderId, dryRun });
    await finishImportJob(jobRef, result);
    return NextResponse.json({ success: true, jobId: jobRef.id, dryRun, ...result });
  } catch (err) {
    await failImportJob(jobRef, err);
    console.error("[import-ordini/woo]", err);
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ success: false, jobId: jobRef.id, error: message }, { status: 500 });
  }
}
