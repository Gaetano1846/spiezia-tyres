import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import {
  getOrdine, updateOrdineStato, appendCronologia, updateOrdineColli,
  updateOrdineIndirizzi, updateOrdineTracking,
} from "@/lib/ordiniDb";
import { getProdottoById } from "@/lib/prodottiDb";

export const runtime = "nodejs";

type StockView = {
  nola: number; nola2: number; roma: number; volla: number;
  ocp: number; t24: number; isT24: boolean;
};

// Stock per magazzino dei prodotti referenziati dagli articoli ordine —
// risolto server-side (getProdottoById ha già il fallback doc-ID Firestore
// storico), decommissioning finale Firebase: sostituisce i getDoc() diretti
// che admin/ordini/[id]/page.tsx faceva client-side su Prodotti.
async function resolveStockByRef(refPaths: string[]): Promise<Record<string, StockView>> {
  const unique = [...new Set(refPaths)];
  const entries = await Promise.all(
    unique.map(async (refPath) => {
      const skuOrDocId = refPath.split("/").pop() ?? refPath;
      const p = await getProdottoById(skuOrDocId);
      if (!p) return null;
      const sv: StockView = {
        nola: p.Stock_Nola, nola2: p.Stock_Nola_2, roma: p.Stock_Roma, volla: p.Stock_Volla,
        ocp: p.Stock_OCP, t24: p.Stock_T24, isT24: p.T24,
      };
      return [refPath, sv] as const;
    })
  );
  return Object.fromEntries(entries.filter((e): e is readonly [string, StockView] => e !== null));
}

// GET /api/admin/ordini/[id] — dettaglio completo (Articoli + Cronologia + Note_Interne + stockByRef).
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
    const refPaths = ordine.Articoli.map((a) => a.RefPath).filter((r): r is string => !!r);
    const stockByRef = await resolveStockByRef(refPaths);
    return NextResponse.json({ ordine, stockByRef });
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
