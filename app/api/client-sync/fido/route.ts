import { NextResponse } from "next/server";
import { verifyInternalSecret, getSession, isAdmin } from "@/lib/auth";
import { runFidoSync } from "@/lib/clientSync/fido";
import { startImportJob, finishImportJob, failImportJob } from "@/lib/importers/jobLog";

// Sostituto interno della Cloud Function `Fido_Management_CSV` (Fase 9-ter).
// Doppio trigger, come l'originale: cron VPS ogni 3 ore (`x-internal-secret`)
// E pulsante "Aggiorna Fido" in admin/clienti (sessione Admin) — entrambi
// passano da qui invece che dall'URL Cloud Function diretto.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await getSession();
  const authorized = verifyInternalSecret(req) || isAdmin(session);
  if (!authorized) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "true";

  const jobRef = await startImportJob("fido-sync", { dryRun });
  try {
    const result = await runFidoSync({ dryRun });
    await finishImportJob(jobRef, result);
    return NextResponse.json({ success: true, jobId: jobRef.id, dryRun, ...result });
  } catch (err) {
    await failImportJob(jobRef, err);
    console.error("[client-sync/fido]", err);
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ success: false, jobId: jobRef.id, error: message }, { status: 500 });
  }
}
