import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { updatePromozione, deletePromozione } from "@/lib/promozioniDb";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
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
    const promozione = await updatePromozione(id, {
      brandNome: (body.brandNome as string[]) ?? [],
      stagione: (body.stagione as string[]) ?? [],
      raggio: (body.raggio as string[]) ?? [],
      clientiIds: (body.clientiIds as string[]) ?? [],
      attiva: Boolean(body.attiva),
      scadenza: body.scadenza as string,
      fisso: Boolean(body.fisso),
      importo: body.importo as number,
    });
    if (!promozione) return NextResponse.json({ error: "Non trovata" }, { status: 404 });
    return NextResponse.json({ promozione });
  } catch (err) {
    console.error("[api/promozioni/:id PATCH]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  try {
    await deletePromozione(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/promozioni/:id DELETE]", err);
    return NextResponse.json({ error: "Errore nell'eliminazione" }, { status: 500 });
  }
}
