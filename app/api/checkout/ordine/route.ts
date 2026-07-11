import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import { createOrdine } from "@/lib/ordiniDb";
import { checkAndDecrementFido, refundFido } from "@/lib/clientiDb";

// Creazione ordine — SERVER-SIDE (bypassa le Firestore Security Rules, che
// richiedono `request.auth != null`; con l'auth VPS-native un cliente con
// sola password Postgres non ha un token Firebase Auth valido). Il server
// usa `getSession()` (affidabile per entrambi i backend).
//
// Fase 2 migrazione Ordini: l'ordine viene scritto DIRETTAMENTE su Postgres
// (core.ordini via lib/ordiniDb.ts::createOrdine) — il bridge esistente lo
// propaga verso Firestore per il CRM Flutter, stesso pattern già in
// produzione per Tyre24 (lib/importers/tyre24PgWrite.js). Scrittura e
// lettura (app/(client)/ordini/[id], già Postgres dalla Fase 1) sono ora
// sullo STESSO sistema — chiude la finestra di lag lettura-dopo-scrittura
// che si sarebbe aperta lasciando la scrittura su Firestore.
//
// Il numero ordine RESTA allocato da Firestore Counters/{sedeId} (invariato):
// il CRM Flutter legacy crea ancora ordini con numerazione propria e
// Counters è l'unico punto di serializzazione condiviso — vedi
// lib/counters.ts. Solo la RIGA fisica dell'ordine si sposta su Postgres.

interface AddressPayload {
  nome: string; via: string; cap: string; citta: string; provincia: string; partitaIva: string;
}
interface ArticoloPayload {
  id: string; marca: string; modello: string; quantita: number;
  prezzoScontato: number; pfu: number; sconto?: number;
}
interface CreateOrdineBody {
  sedeId?: string;
  articoli: ArticoloPayload[];
  totale: number;
  iva: number;
  pfu: number;
  scontoTotale: number;
  contributoLogistico: number;
  fatturazione: AddressPayload;
  spedizione: AddressPayload;
  clienteId?: string;
}

function addr(a: AddressPayload) {
  return {
    Nome: a.nome,
    Cognome: "",
    Via: a.via,
    Civico: "",
    CAP: a.cap,
    Citta: a.citta,
    Provincia: a.provincia,
    Paese: "IT",
    // L'Admin SDK, a differenza del client SDK, rifiuta `undefined` come
    // valore di campo Firestore ("Cannot use 'undefined' as a Firestore
    // value") — null è l'equivalente "assente" accettato.
    PartitaIVA: a.partitaIva || null,
  };
}

function formatNumeroOrdine(n: number): string {
  const year = new Date().getFullYear();
  return `ORD-${year}-${String(n).padStart(5, "0")}`;
}

function normalizeAddr(a: { Via?: unknown; CAP?: unknown; Citta?: unknown }): string {
  return [a.Via, a.CAP, a.Citta].map((v) => String(v ?? "").trim().toLowerCase()).join("|");
}

// Salva l'indirizzo inserito nella rubrica dell'utente (o del cliente, in
// modalità "ordina per conto di"), se non è già presente — così il prossimo
// ordine può riusarlo dal menu "Usa un indirizzo salvato". SERVER-SIDE per lo
// stesso motivo del resto della route (nessun token Firebase Auth lato client
// garantito). Best-effort: un fallimento qui non deve far fallire l'ordine,
// già creato con successo a questo punto. Resta su Firestore (fuori scope
// Fase 2 — solo la riga ordine si sposta su Postgres).
async function saveAddressIfNew(
  colRef: FirebaseFirestore.CollectionReference,
  doc: Record<string, unknown>
): Promise<void> {
  try {
    const existing = await colRef.get();
    const key = normalizeAddr(doc);
    const alreadySaved = existing.docs.some((d) => normalizeAddr(d.data()) === key);
    if (alreadySaved) return;
    await colRef.add(doc);
  } catch (err) {
    console.error("[api/checkout/ordine] salvataggio indirizzo fallito (non bloccante):", err);
  }
}

function fidoBlockedError(isForClient: boolean, rappresentante: string | null): string {
  if (isForClient) {
    // A differenza del messaggio verso il cliente finale (sotto), qui il
    // lettore è staff (Admin/Rappresentante) — menzionare il fido è corretto.
    return "Fido insufficiente per coprire il totale dell'ordine. Contatta l'amministrazione.";
  }
  if (rappresentante) {
    return `Non è possibile completare l'ordine in questo momento. Contatta il tuo rappresentante (${rappresentante}) per procedere.`;
  }
  return "Non è possibile completare l'ordine in questo momento. Contattaci al +39 081 511 5011 per procedere.";
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  let body: CreateOrdineBody;
  try {
    body = (await req.json()) as CreateOrdineBody;
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }

  if (!Array.isArray(body.articoli) || body.articoli.length === 0) {
    return NextResponse.json({ error: "Carrello vuoto" }, { status: 400 });
  }
  if (!body.fatturazione?.nome || !body.fatturazione?.via || !body.fatturazione?.cap || !body.fatturazione?.citta) {
    return NextResponse.json({ error: "Indirizzo di fatturazione incompleto" }, { status: 400 });
  }

  // "Ordina per conto di un cliente" — riservato ad Admin e Rappresentanti,
  // stesso gating della UI (app/(client)/checkout/page.tsx), riverificato qui
  // perché il client non è una fonte fidata per l'autorizzazione.
  const canOrderForClient = session.Ruolo === "Admin" || session.Ruolo === "Rappresentante";
  if (body.clienteId && !canOrderForClient) {
    return NextResponse.json({ error: "Non autorizzato a ordinare per conto di un cliente" }, { status: 403 });
  }

  const db = adminDb();
  const sedeId = body.sedeId || "main";
  const forClient = canOrderForClient && !!body.clienteId;
  const fidoTable = forClient ? "clienti" : "utenti";
  const fidoId = forClient ? (body.clienteId as string) : session.uid;

  // Check+scalo atomico del fido (chiude la finestra TOCTOU del vecchio
  // check-poi-decrementa in due passaggi separati). Va PRIMA della creazione
  // ordine: se l'ordine fallisce dopo, il fido va riaccreditato (vedi catch).
  const fidoResult = await checkAndDecrementFido(fidoTable, fidoId, body.totale);
  if (!fidoResult.ok) {
    return NextResponse.json(
      { error: fidoBlockedError(forClient, fidoResult.rappresentante), code: "ORDER_BLOCKED" },
      { status: 403 }
    );
  }

  try {
    // Il numero ordine resta allocato dalla transazione Firestore Counters —
    // il CRM Flutter legacy crea ancora ordini con numerazione propria e
    // questo è l'unico punto di serializzazione condiviso (vedi commento in
    // testa al file).
    const counterRef = db.doc(`Counters/${sedeId}`);
    const numero = await db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists ? ((snap.data() as Record<string, number>).Ordine ?? 0) : 0;
      const next = current + 1;
      tx.set(counterRef, { Ordine: next }, { merge: true });
      return next;
    });
    const numeroDisplay = formatNumeroOrdine(numero);

    const { id } = await createOrdine({
      numero,
      numeroDisplay,
      source: "B2B",
      stato: "In Preparazione",
      sedeId,
      utenteId: session.uid,
      clienteId: forClient ? body.clienteId : null,
      createdBy: forClient ? session.uid : null,
      totale: body.totale,
      iva: body.iva,
      pfu: body.pfu,
      scontoTotale: body.scontoTotale,
      contributoLogistico: body.contributoLogistico,
      pagamento: { Metodo: "Da definire", Stato: "In attesa" },
      indirizzoFatturazione: addr(body.fatturazione),
      indirizzoSpedizione: addr(body.spedizione ?? body.fatturazione),
      articoli: body.articoli.map((i) => ({
        titolo: `${i.marca} ${i.modello}`,
        marca: i.marca,
        quantita: i.quantita,
        prezzoUnitario: i.prezzoScontato,
        pfu: i.pfu,
        // Prodotti resta su Firestore — Prodotto è l'id doc originale, qui
        // ricostruito come path completo per lo stock-lookup lato dettaglio.
        refPath: `Prodotti/${i.id}`,
        ...(i.sconto ? { fsExtra: { ScontoApplicato: i.sconto } } : {}),
      })),
    });

    // Salva l'indirizzo di fatturazione (e quello di spedizione, se diverso)
    // nella rubrica per il riuso futuro — del cliente selezionato in modalità
    // "ordina per conto di", altrimenti dell'utente che ha ordinato.
    if (forClient) {
      const col = db.collection(`Clienti/${body.clienteId}/Indirizzo_FatturazioneC`);
      const clienteAddr = (a: AddressPayload) => ({
        Ragione_Sociale: a.nome, Via: a.via, CAP: a.cap, Citta: a.citta,
        Provincia: a.provincia, PartitaIVA: a.partitaIva || null,
      });
      await saveAddressIfNew(col, clienteAddr(body.fatturazione));
      if (body.spedizione && normalizeAddr(clienteAddr(body.spedizione)) !== normalizeAddr(clienteAddr(body.fatturazione))) {
        await saveAddressIfNew(col, clienteAddr(body.spedizione));
      }
    } else {
      const col = db.collection(`users/${session.uid}/Indirizzo_Fatturazione`);
      const userAddr = (a: AddressPayload) => ({
        Nome: a.nome, Via: a.via, CAP: a.cap, Citta: a.citta,
        Provincia: a.provincia, PartitaIVA: a.partitaIva || null,
      });
      await saveAddressIfNew(col, userAddr(body.fatturazione));
      if (body.spedizione && normalizeAddr(userAddr(body.spedizione)) !== normalizeAddr(userAddr(body.fatturazione))) {
        await saveAddressIfNew(col, userAddr(body.spedizione));
      }
    }

    return NextResponse.json({ id, numero: numeroDisplay });
  } catch (err) {
    if (fidoResult.hasFido) {
      // L'ordine non è stato creato ma il fido è già stato scalato —
      // compensazione per non lasciare un plafond eroso senza ordine
      // corrispondente (il prossimo sync CSV lo correggerebbe comunque, ma
      // non va lasciato errato nel frattempo).
      await refundFido(fidoTable, fidoId, body.totale).catch((refundErr) => {
        console.error("[api/checkout/ordine] refund fido fallito dopo errore ordine — richiede verifica manuale:", fidoTable, fidoId, body.totale, refundErr);
      });
    }
    console.error("[api/checkout/ordine]", err);
    return NextResponse.json({ error: "Errore nella creazione dell'ordine" }, { status: 500 });
  }
}
