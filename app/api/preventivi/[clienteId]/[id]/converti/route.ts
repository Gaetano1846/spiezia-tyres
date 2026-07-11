import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { getPreventivo } from "@/lib/preventiviDb";

export const runtime = "nodejs";

// POST /api/preventivi/{clienteId}/{id}/converti → { id, numero }
//
// "Converti in Ordine" resta VOLUTAMENTE Firestore diretto (dominio Ordini
// escluso da questa migrazione — vedi commento originale nella pagina). Qui
// cambia solo il MECCANISMO: contatore + scrittura Ordini + flag di
// conversione sul Preventivo, tutto SERVER-SIDE via Admin SDK invece che dal
// browser — le Firestore Security Rules richiedono un token Firebase Auth
// live che un operatore autenticato solo via Postgres (auth VPS-native) non
// ha, quindi la scrittura client-side falliva sempre con permission-denied.

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

    const articoliOrdine = arts.map((a) => ({
      Prodotto: a.Misura ?? "",
      Titolo: a.Modello ?? "",
      Marca: a.Marca ?? "",
      Quantita: a.Quantita ?? 0,
      PrezzoUnitario: a.PrezzoUnitario ?? 0,
      PFU: a.PFU ?? 0,
    }));

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

    const payload = {
      Numero: numeroOrdine,
      Cliente: db.doc(`Clienti/${clienteId}`),
      Source: "B2B",
      Stato: "In Lavorazione",
      Articoli: articoliOrdine,
      Totale: round2(totale),
      IVA: round2(iva),
      PFU: round2(totPfu),
      Note: preventivo.Note ?? null,
      DataCreazione: FieldValue.serverTimestamp(),
    };

    const ordineRef = await db.collection("Ordini").add(payload);
    await db.doc(`Clienti/${clienteId}/Preventivo/${id}`).update({
      Convertito: true,
      OrdineId: ordineRef.id,
    });

    return NextResponse.json({ id: ordineRef.id, numero: numeroOrdine });
  } catch (err) {
    console.error("[api/preventivi/converti]", err);
    return NextResponse.json({ error: "Errore nella creazione dell'ordine" }, { status: 500 });
  }
}
