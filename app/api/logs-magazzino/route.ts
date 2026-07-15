import { NextResponse, type NextRequest } from "next/server";
import { getSession, isMagazzino } from "@/lib/auth";
import { listLogsMagazzino, appendLogMagazzino } from "@/lib/logsMagazzinoDb";

export const runtime = "nodejs";

// GET /api/logs-magazzino?dataDa=&dataA=&azione=&prodottoId=&sedeId=&limit=&offset=
// — sostituisce PagedListView Firestore (screen Logs) + ricerca per prodotto
// (app Flutter magazzino), e serve anche la pagina admin "Log Magazzino"
// (isMagazzino include gia' il ruolo admin, vedi lib/auth.ts). limit/offset
// e sedeId sono usati solo lato admin — l'app Flutter non li invia mai.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  try {
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");
    const { logs, hasMore } = await listLogsMagazzino({
      dataDa: searchParams.get("dataDa") ?? undefined,
      dataA: searchParams.get("dataA") ?? undefined,
      azione: searchParams.get("azione") ?? undefined,
      prodottoId: searchParams.get("prodottoId") ?? undefined,
      sedeId: searchParams.get("sedeId") ?? undefined,
      limit: limitParam ? Number(limitParam) : undefined,
      offset: offsetParam ? Number(offsetParam) : undefined,
    });
    return NextResponse.json({ logs, hasMore });
  } catch (err) {
    console.error("[api/logs-magazzino GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento" }, { status: 500 });
  }
}

// POST /api/logs-magazzino — registra un movimento magazzino (screen Ordini,
// ad ogni "Approva" articolo). utenteId preso dalla sessione, non dal body.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const azione = typeof body.azione === "string" ? body.azione : "";
  const quantita = Number(body.quantita ?? 0);
  if (!azione) return NextResponse.json({ error: "azione obbligatoria" }, { status: 400 });

  try {
    const id = await appendLogMagazzino({
      utenteId: session.uid,
      azione,
      quantita,
      prodottoId: typeof body.prodottoId === "string" ? body.prodottoId : null,
      gabbiaId: typeof body.gabbiaId === "string" ? body.gabbiaId : null,
      motivo: typeof body.motivo === "string" ? body.motivo : null,
      sedeId: typeof body.sedeId === "string" ? body.sedeId : null,
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[api/logs-magazzino POST]", err);
    return NextResponse.json({ error: "Errore nella scrittura" }, { status: 500 });
  }
}
