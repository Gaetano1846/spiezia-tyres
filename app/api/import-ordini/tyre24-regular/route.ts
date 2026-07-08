import { NextResponse } from "next/server";
import { verifyInternalSecret } from "@/lib/auth";
import { runTyre24RegularImport } from "@/lib/importers/tyre24Regular";
import { startImportJob, finishImportJob, failImportJob } from "@/lib/importers/jobLog";

// Sostituto interno della Cloud Function `processOrdersScheduled`/
// `processOrdersManual` (Tyre24 "Regular", clienti registrati — Fase 9).
// Chiamata da crontab VPS ogni 15 minuti (stesso schedule di Cloud
// Scheduler), autenticata via header x-internal-secret.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!verifyInternalSecret(req)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "true";

  const jobRef = await startImportJob("tyre24-regular", { dryRun });
  try {
    const result = await runTyre24RegularImport({ dryRun });
    await finishImportJob(jobRef, result);
    return NextResponse.json({ success: true, jobId: jobRef.id, dryRun, ...result });
  } catch (err) {
    await failImportJob(jobRef, err);
    console.error("[import-ordini/tyre24-regular]", err);
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ success: false, jobId: jobRef.id, error: message }, { status: 500 });
  }
}
