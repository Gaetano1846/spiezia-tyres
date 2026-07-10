import { NextResponse } from "next/server";
import { verifyInternalSecret } from "@/lib/auth";
import { runAdtyresCsvExport } from "@/lib/catalogExport/adtyresCsv";
import { startImportJob, finishImportJob, failImportJob } from "@/lib/importers/jobLog";

// Sostituto interno della Cloud Function `exportadtyres` (Fase 9-quinquies).
// Chiamata da crontab VPS ogni 30 minuti (stesso schedule del Cloud Scheduler
// GCP `exportadtyres-cron`), autenticata via header x-internal-secret.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!verifyInternalSecret(req)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "true";

  const jobRef = await startImportJob("adtyres-csv-export", { dryRun });
  try {
    const result = await runAdtyresCsvExport({ dryRun });
    await finishImportJob(jobRef, result);
    return NextResponse.json({ success: true, jobId: jobRef.id, dryRun, ...result });
  } catch (err) {
    await failImportJob(jobRef, err);
    console.error("[catalog-export/adtyres-csv]", err);
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ success: false, jobId: jobRef.id, error: message }, { status: 500 });
  }
}
