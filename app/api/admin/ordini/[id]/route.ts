import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import {
  getOrdine, updateOrdineStato, appendCronologia, updateOrdineColli,
  updateOrdineIndirizzi, updateOrdineTracking,
} from "@/lib/ordiniDb";

export const runtime = "nodejs";

// GET /api/admin/ordini/[id] — dettaglio completo (Articoli + Cronologia + Note_Interne).
// Sostituisce il getDoc Firestore diretto (client SDK) di admin/ordini/[id]/page.tsx.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const ordine = await getOrdine(id);
    if (!ordine) return NextResponse.json({ error: "Ordine non trovato" }, { status: 404 });
    return NextResponse.json({ ordine });
  } catch (err) {
    console.error("[api/admin/ordini/[id] GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento ordine" }, { status: 500 });
  }
}

type PatchBody =
  | { action: "stato"; stato: string; glsTrackingNumber?: string }
  | { action: "annulla"; motivo: string }
  | { action: "colli"; colli: number; peso: number }
  | { action: "tracking"; trackingNumber: string }
  | { action: "indirizzo"; tipo: "fatturazione" | "spedizione"; valore: Record<string, unknown> };

// PATCH /api/admin/ordini/[id] — cambio-stato/annullamento/colli/tracking/indirizzo
// (Fase 4 migrazione Spedizioni/GLS). Consolida in un unico punto server-side la
// logica Stato+Cronologia prima duplicata a mano nel dettaglio ordine e nella
// lista ordini (updateDoc/addDoc Firestore client-side) — necessario comunque
// perché un admin autenticato solo via Postgres (auth VPS-native) non ha un
// token Firebase Auth valido per scrivere direttamente su Firestore.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }

  const operatore = session.email || "Operatore";

  try {
    switch (body.action) {
      case "stato": {
        if (!body.stato) return NextResponse.json({ error: "Stato mancante" }, { status: 400 });
        await updateOrdineStato(id, body.stato, { glsTrackingNumber: body.glsTrackingNumber ?? null });
        await appendCronologia(id, { azione: `Stato → ${body.stato}`, operatore });
        break;
      }
      case "annulla": {
        const motivo = body.motivo?.trim();
        if (!motivo) return NextResponse.json({ error: "Motivo mancante" }, { status: 400 });
        await updateOrdineStato(id, "Annullato", { motivoAnnullamento: motivo });
        await appendCronologia(id, { azione: "Stato → Annullato", nota: motivo, operatore });
        break;
      }
      case "colli": {
        await updateOrdineColli(id, body.colli, body.peso);
        break;
      }
      case "tracking": {
        if (!body.trackingNumber) return NextResponse.json({ error: "Tracking mancante" }, { status: 400 });
        await updateOrdineTracking(id, body.trackingNumber);
        break;
      }
      case "indirizzo": {
        const key = body.tipo === "fatturazione" ? "indirizzoFatturazione" : "indirizzoSpedizione";
        await updateOrdineIndirizzi(id, { [key]: body.valore });
        break;
      }
      default:
        return NextResponse.json({ error: "Azione non riconosciuta" }, { status: 400 });
    }

    const ordine = await getOrdine(id);
    if (!ordine) return NextResponse.json({ error: "Ordine non trovato" }, { status: 404 });
    return NextResponse.json({ ordine });
  } catch (err) {
    console.error("[api/admin/ordini/[id] PATCH]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento ordine" }, { status: 500 });
  }
}
