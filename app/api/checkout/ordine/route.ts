import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

// Creazione ordine — SERVER-SIDE via Admin SDK (bypassa le Firestore Security
// Rules, che richiedono `request.auth != null`). Il checkout NON deve più
// scrivere Ordini/Counters direttamente dal browser: con l'auth VPS-native
// (Postgres-primaria, Firebase solo best-effort) un cliente creato con sola
// password Postgres non ha un token Firebase Auth valido — qualunque
// scrittura client-side su queste collezioni fallirebbe sempre con
// permission-denied. Il server usa `getSession()` (affidabile per entrambi i
// backend) e scrive su Firestore con privilegi Admin.

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
// già creato con successo a questo punto.
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

// Scalo PROVVISORIO del fido residuo: il Fido reale arriva dal gestionale via
// CSV (vedi lib/clientSync/fido.js, sync ogni 3h) — non è mai stato scalato
// in tempo reale alla creazione ordine, né in Flutter né qui. Su richiesta
// esplicita, un ordine ora decrementa SUBITO Fido_Residuo come stima
// immediata: il prossimo sync CSV lo sovrascrive col valore reale
// (autoritativo), quindi eventuali disallineamenti si correggono da soli
// entro poche ore. Decrementa solo se il doc ha un Fido configurato (altrimenti
// creerebbe un residuo negativo fittizio per chi non ha un plafond credito).
async function decrementFidoResiduoIfConfigured(
  docRef: FirebaseFirestore.DocumentReference,
  importo: number
): Promise<void> {
  try {
    const snap = await docRef.get();
    if (!snap.exists) return;
    const d = snap.data() as Record<string, unknown>;
    if (typeof d.Fido !== "number") return;
    await docRef.update({ Fido_Residuo: FieldValue.increment(-importo) });
  } catch (err) {
    console.error("[api/checkout/ordine] scalo provvisorio fido fallito (non bloccante):", err);
  }
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

  try {
    const db = adminDb();
    const sedeId = body.sedeId || "main";
    const counterRef = db.doc(`Counters/${sedeId}`);

    const numero = await db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists ? ((snap.data() as Record<string, number>).Ordine ?? 0) : 0;
      const next = current + 1;
      tx.set(counterRef, { Ordine: next }, { merge: true });
      return next;
    });

    const orderData: Record<string, unknown> = {
      Utente: db.doc(`users/${session.uid}`),
      Source: "B2B",
      Stato: "In Preparazione",
      Numero: formatNumeroOrdine(numero),
      Articoli: body.articoli.map((i) => ({
        Prodotto: i.id,
        Titolo: `${i.marca} ${i.modello}`,
        Marca: i.marca,
        Quantita: i.quantita,
        PrezzoUnitario: i.prezzoScontato,
        PFU: i.pfu,
        ...(i.sconto ? { ScontoApplicato: i.sconto } : {}),
      })),
      Totale: body.totale,
      IVA: body.iva,
      PFU: body.pfu,
      ScontoTotale: body.scontoTotale,
      Pagamento: { Metodo: "Da definire", Stato: "In attesa" },
      ContributoLogistico: body.contributoLogistico,
      IndirizzoFatturazione: addr(body.fatturazione),
      IndirizzoSpedizione: addr(body.spedizione ?? body.fatturazione),
      DataCreazione: FieldValue.serverTimestamp(),
    };

    if (canOrderForClient && body.clienteId) {
      orderData.Cliente = db.doc(`Clienti/${body.clienteId}`);
      orderData.createdBy = session.uid;
    }

    const ref = await db.collection("Ordini").add(orderData);

    // Salva l'indirizzo di fatturazione (e quello di spedizione, se diverso)
    // nella rubrica per il riuso futuro — del cliente selezionato in modalità
    // "ordina per conto di", altrimenti dell'utente che ha ordinato.
    if (canOrderForClient && body.clienteId) {
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

    // Scalo provvisorio del fido — vedi commento su decrementFidoResiduoIfConfigured.
    const fidoDocRef = canOrderForClient && body.clienteId
      ? db.doc(`Clienti/${body.clienteId}`)
      : db.doc(`users/${session.uid}`);
    await decrementFidoResiduoIfConfigured(fidoDocRef, body.totale);

    return NextResponse.json({ id: ref.id, numero: orderData.Numero as string });
  } catch (err) {
    console.error("[api/checkout/ordine]", err);
    return NextResponse.json({ error: "Errore nella creazione dell'ordine" }, { status: 500 });
  }
}
