import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { getAnalisiJob } from "@/lib/tyre24/analisiDb";

export const runtime = "nodejs";

// GET /api/tyre24/analisi/[id] — stato del job di analisi prezzi Tyre24, per
// il polling della pagina admin (stesso pattern di
// app/api/spedizioni/jobs/[id]/route.ts — nessuna infra WebSocket/SSE nel repo).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const job = await getAnalisiJob(id);
    if (!job) return NextResponse.json({ error: "Job non trovato" }, { status: 404 });
    return NextResponse.json({ job });
  } catch (err) {
    console.error("[api/tyre24/analisi/[id] GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento job" }, { status: 500 });
  }
}
