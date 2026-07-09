import { NextResponse } from "next/server";
import { verifyInternalSecret } from "@/lib/auth";
import { runProdottiCsvExport } from "@/lib/catalogExport/prodottiCsv";
import { startImportJob, finishImportJob, failImportJob } from "@/lib/importers/jobLog";

// Sostituto interno della Cloud Function `prodotti-csv-export` (Fase 9-ter).
// Chiamata da crontab VPS ogni 15 minuti (stesso intervallo dell'esterno
// cron-job.org che chiamava la Cloud Function), autenticata via header
// x-internal-secret.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!verifyInternalSecret(req)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "true";

  const jobRef = await startImportJob("prodotti-csv-export", { dryRun });
  try {
    const result = await runProdottiCsvExport({ dryRun });
    await finishImportJob(jobRef, result);
    return NextResponse.json({ success: true, jobId: jobRef.id, dryRun, ...result });
  } catch (err) {
    await failImportJob(jobRef, err);
    console.error("[catalog-export/prodotti-csv]", err);
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ success: false, jobId: jobRef.id, error: message }, { status: 500 });
  }
}
