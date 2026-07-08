import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM } from "@/lib/auth";
import { listNotifiche } from "@/lib/notificheDb";

export const runtime = "nodejs";

// GET /api/notifiche — sostituisce collection(db,"Notifiche") in app/(crm)/notifiche.
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  try {
    const notifiche = await listNotifiche(100);
    return NextResponse.json({ notifiche });
  } catch (err) {
    console.error("[api/notifiche GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento notifiche" }, { status: 500 });
  }
}
