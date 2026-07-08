import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { listPromozioni, createPromozione } from "@/lib/promozioniDb";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  try {
    const promozioni = await listPromozioni(200);
    return NextResponse.json({ promozioni });
  } catch (err) {
    console.error("[api/promozioni GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  if (!body.scadenza || typeof body.importo !== "number" || body.importo <= 0) {
    return NextResponse.json({ error: "Scadenza e importo sono obbligatori" }, { status: 400 });
  }

  try {
    const promozione = await createPromozione({
      brandNome: (body.brandNome as string[]) ?? [],
      stagione: (body.stagione as string[]) ?? [],
      raggio: (body.raggio as string[]) ?? [],
      clientiIds: (body.clientiIds as string[]) ?? [],
      attiva: Boolean(body.attiva),
      scadenza: body.scadenza as string,
      fisso: Boolean(body.fisso),
      importo: body.importo as number,
    });
    return NextResponse.json({ promozione }, { status: 201 });
  } catch (err) {
    console.error("[api/promozioni POST]", err);
    return NextResponse.json({ error: "Errore nella creazione" }, { status: 500 });
  }
}
