import { NextResponse } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { sendEmailReply } from "@/lib/emailAdmin/sendReply";

// Sostituto interno della Cloud Function `send_email_reply` (Fase 9-quater
// C). Chiamata dal bottone "Invia risposta" in admin/email — azione umana da
// sessione, non machine-to-machine. Invio email reale: nessun dry-run.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.to || !(body?.html || body?.htmlBody)) {
    return NextResponse.json({ error: "Campi obbligatori mancanti: 'to' o 'html'" }, { status: 400 });
  }

  try {
    const result = await sendEmailReply(body);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[email-admin/send-reply]", err);
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
