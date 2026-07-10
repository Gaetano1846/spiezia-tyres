import { NextResponse } from "next/server";
import { processMarketplaceAction } from "@/lib/marketplace/sdk";
import { getSession, isAdmin } from "@/lib/auth";

// Port interno delle integrazioni marketplace della vecchia CF ExternalApiIntegrations.
// POST body JSON:
//   { action: "pushTracking", ordineId, corriere }  → push tracking al marketplace di origine
// Protetta da sessione admin (come /api/gls-italy): esegue chiamate reali ai marketplace.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
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

  const { statusCode, payload } = await processMarketplaceAction(body);
  return NextResponse.json(payload, { status: statusCode });
}
