import { NextResponse } from "next/server";
import { verifyInternalSecret } from "@/lib/auth";
import { runEbayWebhookImport } from "@/lib/importers/ebay";
import { startImportJob, finishImportJob, failImportJob } from "@/lib/importers/jobLog";

// Sostituto interno della Cloud Function `ebayOrderWebhook` (Fase 9-quinquies).
// eBay Platform Notifications (formato XML legacy) non supporta firma HMAC:
// l'endpoint va registrato su eBay Developer Portal con l'URL già completo di
// `?internal_secret=...` (letto da verifyInternalSecret via query string).
// GET risponde 200 per la verifica iniziale del portale eBay (stesso
// comportamento della CF originale); POST riceve la notifica XML reale o un
// trigger manuale/test `{ orderId }` in JSON.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!verifyInternalSecret(req)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  return new NextResponse("OK", { status: 200 });
}

export async function POST(req: Request) {
  if (!verifyInternalSecret(req)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const rawBody = await req.text();
  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "true";

  const isXml = rawBody.trim().startsWith("<");
  let orderId: string | undefined;
  if (!isXml && rawBody) {
    try {
      const payload = JSON.parse(rawBody);
      if (typeof payload.orderId === "string") orderId = payload.orderId;
    } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
    }
  }

  const jobRef = await startImportJob("ebay", { dryRun });
  try {
    const result = await runEbayWebhookImport(isXml ? { rawXml: rawBody, dryRun } : { orderId, dryRun });
    await finishImportJob(jobRef, result);
    // eBay considera qualunque status diverso da 200 una consegna fallita e
    // riprova/può disattivare il webhook — 200 sempre, anche per eventi
    // ignorati o errori interni (stesso comportamento della CF originale,
    // che logga e ingoia ogni errore prima di rispondere OK).
    return NextResponse.json({ success: true, jobId: jobRef.id, dryRun, ...result });
  } catch (err) {
    await failImportJob(jobRef, err);
    console.error("[import-ordini/ebay]", err);
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ success: false, jobId: jobRef.id, error: message });
  }
}
