import { NextResponse, type NextRequest } from "next/server";
import { getSession, isMagazzino } from "@/lib/auth";
import { getGabbia } from "@/lib/magazzinoDb";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  const gabbia = await getGabbia(id);
  if (!gabbia) return NextResponse.json({ error: "Non trovata" }, { status: 404 });
  return NextResponse.json({ gabbia });
}
