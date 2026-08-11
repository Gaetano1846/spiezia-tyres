import { NextResponse } from "next/server";
import { createOrdine, resolveSedeId, type CreateOrdineArticoloInput } from "@/lib/ordiniDb";
import { findClienteByEmail, createCliente } from "@/lib/clientiDb";
import { adminDb } from "@/lib/firebase-admin";

// Endpoint pubblico del checkout Vetrina (storefront separato, Flutter Web
// su Firebase Hosting) — sostituisce la scrittura diretta Firestore
// (createOrdiniRecordData in checkout_widget.dart) per rendere l'ordine
// indipendente dal bridge Postgres<->Firestore (spiezia-bridge), che si
// vuole spegnere. Nessuna sessione: Vetrina è un checkout guest, il cliente
// viene risolto/creato per email (stesso pattern di
// lib/importers/zr07.js::processCustomer per gli ordini 07ZR), senza
// credenziale di login — l'autenticazione Vetrina resta Firebase, fuori
// scope di questa migrazione (che riguarda solo la persistenza ordine).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface IndirizzoPayload {
  destinatario?: string;
  companyName?: string;
  via?: string;
  cap?: string;
  citta?: string;
  provincia?: string;
  paese?: string;
  partitaIva?: string;
  codiceFiscale?: string;
  telefono?: string;
}

interface ArticoloPayload {
  sku?: string;
  titolo?: string;
  quantita: number;
  prezzo?: number;
  pfu?: number;
  contributoLogistico?: number;
}

interface VetrinaCheckoutBody {
  numeroOrdine?: string;
  totale: number;
  iva?: number;
  email: string;
  telefono?: string;
  fatturazione: IndirizzoPayload;
  spedizione?: IndirizzoPayload;
  articoli: ArticoloPayload[];
  dataConsegna?: string;
  dataPrenotazione?: string;
  sedeAppuntamento?: string;
}

function addr(a: IndirizzoPayload | undefined | null) {
  if (!a) return null;
  return {
    Nome: a.destinatario || "",
    Via: a.via || "",
    CAP: a.cap || "",
    Citta: a.citta || "",
    Provincia: a.provincia || "",
    Paese: a.paese || "IT",
    Azienda: a.companyName || null,
    PartitaIVA: a.partitaIva || null,
    CodiceFiscale: a.codiceFiscale || null,
  };
}

// Best-effort: risolve il doc Firestore Prodotti per SKU, solo per
// compatibilità con eventuali lettori Firestore legacy residui (stesso
// motivo/stesso pattern di lib/importers/zr07.js). Non blocca l'ordine se
// non trovato — public.prodotti (keyed by SKU) resta la fonte per tutto il
// resto (ricerca, stock, admin).
async function findRefPath(sku: string): Promise<string | null> {
  try {
    const snap = await adminDb().collection("Prodotti").where("SKU", "==", sku).limit(1).get();
    return snap.empty ? null : `Prodotti/${snap.docs[0].id}`;
  } catch (err) {
    console.error("[api/checkout/vetrina] lookup Firestore Prodotti fallito (non bloccante):", err);
    return null;
  }
}

export async function POST(req: Request) {
  let body: VetrinaCheckoutBody;
  try {
    body = (await req.json()) as VetrinaCheckoutBody;
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }

  if (!Array.isArray(body.articoli) || body.articoli.length === 0) {
    return NextResponse.json({ error: "Carrello vuoto" }, { status: 400 });
  }
  if (!body.email || !body.fatturazione?.via || !body.fatturazione?.cap || !body.fatturazione?.citta) {
    return NextResponse.json({ error: "Dati ordine incompleti" }, { status: 400 });
  }
  if (typeof body.totale !== "number" || !Number.isFinite(body.totale)) {
    return NextResponse.json({ error: "Totale non valido" }, { status: 400 });
  }

  try {
    const email = body.email.trim().toLowerCase();
    let cliente = await findClienteByEmail(email);
    if (!cliente) {
      cliente = await createCliente({
        Nome: body.fatturazione.destinatario || email,
        Ragione_Sociale: body.fatturazione.companyName || undefined,
        Email: email,
        Telefono: body.telefono || body.fatturazione.telefono || "",
        Via: body.fatturazione.via,
        Citta: body.fatturazione.citta,
        CAP: body.fatturazione.cap,
        Paese: body.fatturazione.paese || "IT",
        Codice_Fiscale: body.fatturazione.codiceFiscale || undefined,
        Partita_Iva: body.fatturazione.partitaIva || undefined,
        Azienda: !!body.fatturazione.companyName,
      });
    }

    const sedeId = await resolveSedeId(body.sedeAppuntamento);

    const articoli: CreateOrdineArticoloInput[] = await Promise.all(
      body.articoli.map(async (a) => ({
        sku: a.sku ?? null,
        titolo: a.titolo ?? null,
        quantita: a.quantita,
        prezzoUnitario: a.prezzo ?? null,
        pfu: a.pfu ?? null,
        contributoLogistico: a.contributoLogistico ?? null,
        refPath: a.sku ? await findRefPath(a.sku) : null,
        totRiga: a.prezzo != null ? a.prezzo * a.quantita : null,
      }))
    );

    const { id } = await createOrdine({
      numero: body.numeroOrdine ? Number(body.numeroOrdine) || null : null,
      numeroDisplay: body.numeroOrdine ?? null,
      source: "Vetrina",
      stato: "In Lavorazione",
      clienteId: cliente?.id ?? null,
      sedeId,
      totale: body.totale,
      iva: body.iva ?? null,
      pagamento: { Metodo: "Da definire", Stato: "In attesa" },
      indirizzoFatturazione: addr(body.fatturazione),
      indirizzoSpedizione: addr(body.spedizione ?? body.fatturazione),
      fsExtra: {
        DataConsegna: body.dataConsegna ?? null,
        DataPrenotazione: body.dataPrenotazione ?? null,
        SedeAppuntamento: body.sedeAppuntamento ?? null,
      },
      articoli,
    });

    return NextResponse.json({ id, numero: body.numeroOrdine ?? id });
  } catch (err) {
    console.error("[api/checkout/vetrina]", err);
    return NextResponse.json({ error: "Errore nella creazione dell'ordine" }, { status: 500 });
  }
}
