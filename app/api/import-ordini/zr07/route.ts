import { NextResponse } from "next/server";
import { verifyInternalSecret } from "@/lib/auth";
import { runZr07Import } from "@/lib/importers/zr07";
import { startImportJob, finishImportJob, failImportJob } from "@/lib/importers/jobLog";

// Import ordini 07ZR/Distri2B (Italia/Francia/Germania/Austria) — stesso
// pattern machine-to-machine di /api/import-ordini/adtyres. Chiamata da
// crontab VPS ogni 15 minuti, autenticata via header x-internal-secret
// (nessuna sessione utente).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!verifyInternalSecret(req)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "true";
  const dryRun = searchParams.get("dryRun") === "true";
  const market = searchParams.get("market");

  const jobRef = await startImportJob("zr07", { dryRun });
  try {
    const result = await runZr07Import({ force, dryRun, market });
    await finishImportJob(jobRef, result);
    return NextResponse.json({ success: true, jobId: jobRef.id, dryRun, ...result });
  } catch (err) {
    await failImportJob(jobRef, err);
    console.error("[import-ordini/zr07]", err);
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ success: false, jobId: jobRef.id, error: message }, { status: 500 });
  }
}
