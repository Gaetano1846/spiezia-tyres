import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM } from "@/lib/auth";
import { markAllAsRead } from "@/lib/notificheDb";

export const runtime = "nodejs";

export async function POST(_req: NextRequest) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  try {
    const count = await markAllAsRead();
    return NextResponse.json({ count });
  } catch (err) {
    console.error("[api/notifiche/mark-all-read POST]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}
