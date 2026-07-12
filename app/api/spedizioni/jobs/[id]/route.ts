import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { getSpedizioneJob } from "@/lib/spedizioniDb";

export const runtime = "nodejs";

// GET /api/spedizioni/jobs/[id] — stato di un job bulk GLS (Fase 4.3).
// Sostituisce l'onSnapshot Firestore diretto: SpedizioniJobsWidget fa polling
// breve su questa route invece di un listener realtime (nessuna infra
// WebSocket/SSE in questo repo).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const job = await getSpedizioneJob(id);
    if (!job) return NextResponse.json({ error: "Job non trovato" }, { status: 404 });
    return NextResponse.json({ job });
  } catch (err) {
    console.error("[api/spedizioni/jobs/[id] GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento job" }, { status: 500 });
  }
}
