import { NextResponse, type NextRequest } from "next/server";
import { getSession, isMagazzino } from "@/lib/auth";
import { approvaArticoloSpedizione, annullaSpedizioneMagazzino } from "@/lib/spedizioniDb";

export const runtime = "nodejs";

type PatchBody =
  | { action: "approva-articolo"; ordineId: string; refPath?: string; sku?: string; quantita: number; gabbiaId?: string }
  | { action: "annulla"; ordineId: string; motivo: string; note?: string };

// PATCH /api/magazzino/spedizioni/[id] — azioni operatore magazzino (app
// Flutter "Spiezia Tyres"): approvazione articolo (→ ordine Spedito +
// spedizione warehouseStatus Spedito) o annullamento spedizione. Gated
// isMagazzino (admin o magazziniere), non isAdmin come /api/admin/ordini —
// il personale di magazzino non è admin.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isMagazzino(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "approva-articolo": {
        if (!body.ordineId || (!body.refPath && !body.sku)) {
          return NextResponse.json({ error: "ordineId e (sku o refPath) obbligatori" }, { status: 400 });
        }
        await approvaArticoloSpedizione({
          ordineId: body.ordineId,
          spedizioneId: id,
          refPath: body.refPath ?? null,
          sku: body.sku ?? null,
          quantita: Number(body.quantita ?? 0),
          utenteId: session.uid,
          gabbiaId: body.gabbiaId ?? null,
        });
        break;
      }
      case "annulla": {
        const motivo = body.motivo?.trim();
        if (!body.ordineId || !motivo) {
          return NextResponse.json({ error: "ordineId e motivo obbligatori" }, { status: 400 });
        }
        await annullaSpedizioneMagazzino({ spedizioneId: id, ordineId: body.ordineId, motivo, note: body.note ?? null });
        break;
      }
      default:
        return NextResponse.json({ error: "Azione non riconosciuta" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/magazzino/spedizioni/[id] PATCH]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}
