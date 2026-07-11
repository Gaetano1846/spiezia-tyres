import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import { getPreventivo } from "@/lib/preventiviDb";
import { createOrdine } from "@/lib/ordiniDb";

export const runtime = "nodejs";

// POST /api/preventivi/{clienteId}/{id}/converti → { id, numero }
//
// Fase 2 migrazione Ordini: l'ordine convertito viene scritto direttamente su
// Postgres (core.ordini via lib/ordiniDb.ts::createOrdine), stesso motivo e
// stesso pattern del checkout (vedi app/api/checkout/ordine/route.ts) — la
// lettura del dettaglio ordine (CRM, già Postgres dalla Fase 1) deve stare
// sullo stesso sistema della scrittura per evitare un gap di lag cross-bridge
// subito dopo la conversione. Il flag Convertito/OrdineId sul Preventivo
// resta su Firestore (dominio Preventivi non in scope di questa migrazione),
// scritto SERVER-SIDE via Admin SDK per lo stesso motivo di sempre: un
// operatore autenticato solo via Postgres (auth VPS-native) non ha un token
// Firebase Auth valido, quindi la scrittura client-side fallirebbe sempre con
// permission-denied.

type ServizioDisplay = { titolo: string; prezzo: number; quantita: number };

function getServizi(raw: unknown[]): ServizioDisplay[] {
  return raw
    .map((r) => {
      const s = r as Record<string, unknown>;
      return {
        titolo: (s.Titolo as string) || (s.titolo as string) || "Servizio",
        prezzo: Number(s.Prezzo ?? s.prezzoUnitario ?? s.PrezzoUnitario ?? 0),
        quantita: Number(s.Quantita ?? s.quantita ?? 1),
      };
    })
    .filter((s) => s.prezzo > 0 || s.titolo !== "Servizio");
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ clienteId: string; id: string }> }
) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { clienteId, id } = await params;

  try {
    const preventivo = await getPreventivo(clienteId, id);
    if (!preventivo) return NextResponse.json({ error: "Preventivo non trovato" }, { status: 404 });
    if (preventivo.OrdineId || preventivo.Convertito) {
      return NextResponse.json({ error: "Preventivo già convertito" }, { status: 409 });
    }

    const arts = preventivo.Articoli;
    const servs = getServizi(preventivo.Servizi as unknown[]);

    const totArticoli = arts.reduce(
      (s, a) => s + ((a.PrezzoUnitario ?? 0) + (a.PFU ?? 0)) * (a.Quantita ?? 0), 0
    );
    const totPfu = arts.reduce((s, a) => s + (a.PFU ?? 0) * (a.Quantita ?? 0), 0);
    const totServizi = servs.reduce((s, sv) => s + sv.prezzo * sv.quantita, 0);
    const imponibile = totArticoli + totServizi;
    const iva = imponibile * 0.22;
    const totale = imponibile + iva;

    const db = adminDb();
    const sedeId = preventivo.SedeId ?? "main";
    const counterRef = db.doc(`Counters/${sedeId}`);
    const numero = await db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists ? ((snap.data() as Record<string, number>).Ordine ?? 0) : 0;
      const next = current + 1;
      tx.set(counterRef, { Ordine: next }, { merge: true });
      return next;
    });
    const year = new Date().getFullYear();
    const numeroOrdine = `ORD-${year}-${String(numero).padStart(5, "0")}`;

    const { id: ordineId } = await createOrdine({
      numero,
      numeroDisplay: numeroOrdine,
      source: "B2B",
      stato: "In Lavorazione",
      sedeId,
      clienteId,
      totale: round2(totale),
      iva: round2(iva),
      pfu: round2(totPfu),
      note: preventivo.Note ?? null,
      articoli: arts.map((a) => ({
        titolo: a.Modello ?? "",
        marca: a.Marca ?? "",
        quantita: a.Quantita ?? 0,
        prezzoUnitario: a.PrezzoUnitario ?? 0,
        pfu: a.PFU ?? 0,
        // "Misura" non è un riferimento a un doc Prodotti reale (a differenza
        // del checkout) — stesso campo Prodotto del payload Firestore
        // originale, preservato in fs_extra invece che come RefPath.
        fsExtra: { Prodotto: a.Misura ?? "" },
      })),
    });

    await db.doc(`Clienti/${clienteId}/Preventivo/${id}`).update({
      Convertito: true,
      OrdineId: ordineId,
    });

    return NextResponse.json({ id: ordineId, numero: numeroOrdine });
  } catch (err) {
    console.error("[api/preventivi/converti]", err);
    return NextResponse.json({ error: "Errore nella creazione dell'ordine" }, { status: 500 });
  }
}
