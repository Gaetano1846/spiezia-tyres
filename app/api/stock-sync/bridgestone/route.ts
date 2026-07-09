import { NextResponse } from "next/server";
import { verifyInternalSecret } from "@/lib/auth";
import { runBridgestoneStockSync } from "@/lib/stockSync/bridgestone";
import { startImportJob, finishImportJob, failImportJob } from "@/lib/importers/jobLog";

// Sostituto interno della Cloud Function `bridgestoneStockUpdate` (Fase 9-bis).
// Chiamata da crontab VPS ogni ora (stesso schedule di Cloud Scheduler
// stock-updater-hourly-get), autenticata via header x-internal-secret.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!verifyInternalSecret(req)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "true";

  const jobRef = await startImportJob("bridgestone-stock", { dryRun });
  try {
    const result = await runBridgestoneStockSync({ dryRun });
    await finishImportJob(jobRef, result);
    return NextResponse.json({ success: true, jobId: jobRef.id, dryRun, ...result });
  } catch (err) {
    await failImportJob(jobRef, err);
    console.error("[stock-sync/bridgestone]", err);
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ success: false, jobId: jobRef.id, error: message }, { status: 500 });
  }
}
