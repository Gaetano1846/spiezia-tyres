import { NextResponse } from "next/server";
import { processGlsAction } from "@/lib/gls/sdk";
import { getSession, isAdmin } from "@/lib/auth";

// Sostituto interno della Cloud Function `gls-italy`.
// Stesso protocollo: POST con body JSON { action, contractIndex?, ...params }.
// Gira lato server (Node) sul server Next.js, non più su Google Cloud.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // le creazioni GLS + PDF + upload possono richiedere tempo

export async function POST(req: Request) {
  // La vecchia CF era pubblica (CORS *). Qui invece crea spedizioni reali:
  // la proteggiamo richiedendo una sessione admin.
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { statusCode, payload } = await processGlsAction(body);
  return NextResponse.json(payload, { status: statusCode });
}
