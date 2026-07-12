import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { appendNotaInterna } from "@/lib/ordiniDb";

export const runtime = "nodejs";

// POST /api/admin/ordini/[id]/note-interne — aggiunge una nota interna
// (Fase 4 migrazione Spedizioni/GLS, stesso motivo del PATCH nel file [id]/route.ts).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  let body: { testo?: string };
  try {
    body = (await req.json()) as { testo?: string };
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }

  const testo = body.testo?.trim();
  if (!testo) return NextResponse.json({ error: "Testo mancante" }, { status: 400 });

  try {
    const operatore = session.email || "Operatore";
    const nota = await appendNotaInterna(id, { testo, operatore });
    return NextResponse.json({ id: nota.id, ts: nota.ts, testo, operatore });
  } catch (err) {
    console.error("[api/admin/ordini/[id]/note-interne POST]", err);
    return NextResponse.json({ error: "Errore nel salvataggio nota" }, { status: 500 });
  }
}
