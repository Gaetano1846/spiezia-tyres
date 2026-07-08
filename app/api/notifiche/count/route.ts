import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { countUnread } from "@/lib/notificheDb";

export const runtime = "nodejs";

// GET /api/notifiche/count[?uid=] — badge non lette.
// Senza uid: conteggio globale (era B2BHeader.tsx, query onSnapshot senza filtro Utente).
// Con uid: conteggio per utente (era useUnreadNotifiche, filtro Utente — mai
// popolato nei dati reali, quindi oggi ritorna sempre 0: stesso comportamento
// preservato, non "corretto" oltre lo scope di questa migrazione).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const uid = req.nextUrl.searchParams.get("uid") ?? undefined;
  try {
    const count = await countUnread(uid);
    return NextResponse.json({ count });
  } catch (err) {
    console.error("[api/notifiche/count GET]", err);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}
