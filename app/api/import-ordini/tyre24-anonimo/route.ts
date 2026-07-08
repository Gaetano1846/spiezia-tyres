import { NextResponse } from "next/server";
import { verifyInternalSecret } from "@/lib/auth";
import { runTyre24AnonimoImport } from "@/lib/importers/tyre24Anonimo";
import { startImportJob, finishImportJob, failImportJob } from "@/lib/importers/jobLog";

// Sostituto interno della Cloud Function `processT24Orders`/`processT24OrdersManual`
// (Tyre24 "Anonimo", ordini guest — Fase 9). Chiamata da crontab VPS ogni 15
// minuti (stesso schedule di Cloud Scheduler), autenticata via header
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

  const jobRef = await startImportJob("tyre24-anonimo", { dryRun });
  try {
    const result = await runTyre24AnonimoImport({ dryRun });
    await finishImportJob(jobRef, result);
    return NextResponse.json({ success: true, jobId: jobRef.id, dryRun, ...result });
  } catch (err) {
    await failImportJob(jobRef, err);
    console.error("[import-ordini/tyre24-anonimo]", err);
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ success: false, jobId: jobRef.id, error: message }, { status: 500 });
  }
}
