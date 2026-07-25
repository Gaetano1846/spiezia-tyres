import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { getEmail, markEmailRead, markEmailReplied } from "@/lib/emailsDb";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  const email = await getEmail(id);
  if (!email) return NextResponse.json({ error: "Email non trovata" }, { status: 404 });
  return NextResponse.json({ email });
}

// PATCH /api/emails/:id — { action: "read" | "replied" }. Azioni distinte
// (non un PATCH generico) perché sono le uniche due mutazioni fatte dalla
// pagina admin/email: apertura (segna letta) e invio risposta (segna
// risposta inviata, implica anche letta).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  let body: { action?: string };
  try {
    body = (await req.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }

  try {
    if (body.action === "read") await markEmailRead(id);
    else if (body.action === "replied") await markEmailReplied(id);
    else return NextResponse.json({ error: "action non valida" }, { status: 400 });

    const email = await getEmail(id);
    if (!email) return NextResponse.json({ error: "Email non trovata" }, { status: 404 });
    return NextResponse.json({ email });
  } catch (err) {
    console.error("[api/emails/:id PATCH]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}
