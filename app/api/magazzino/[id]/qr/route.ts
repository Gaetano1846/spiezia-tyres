import { NextResponse, type NextRequest } from "next/server";
import { getSession, isMagazzino } from "@/lib/auth";
import { generateGabbiaQr } from "@/lib/magazzinoDb";

// Sostituto interno della Cloud Function `GenerateQR` (Fase 9-quinquies).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null) as { link?: string } | null;
  const link = body?.link;
  if (!link) return NextResponse.json({ error: "'link' richiesto" }, { status: 400 });
  try {
    new URL(link);
  } catch {
    return NextResponse.json({ error: "URL non valida in 'link'" }, { status: 400 });
  }

  try {
    const qrUrl = await generateGabbiaQr(id, link);
    return NextResponse.json({ success: true, QR_code_url: qrUrl });
  } catch (err) {
    console.error("[magazzino/qr]", err);
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
