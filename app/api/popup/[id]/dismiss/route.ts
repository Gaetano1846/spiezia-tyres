import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { dismissPopup } from "@/lib/popupDb";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const { id } = await params;
  try {
    await dismissPopup(id, session.uid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/popup/:id/dismiss POST]", err);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}
