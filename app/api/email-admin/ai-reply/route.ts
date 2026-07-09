import { NextResponse } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { generateAiReply } from "@/lib/emailAdmin/aiReply";

// Sostituto interno della Cloud Function `generate_ai_reply` (Fase 9-quater
// C). Chiamata dal bottone "Genera AI" in admin/email — azione umana da
// sessione, non machine-to-machine.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const emailId = body?.emailId;
  if (!emailId || typeof emailId !== "string") {
    return NextResponse.json({ error: "emailId mancante" }, { status: 400 });
  }

  try {
    const result = await generateAiReply(emailId);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[email-admin/ai-reply]", err);
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
