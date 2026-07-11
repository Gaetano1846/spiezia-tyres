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
    PartitaIVA: a.partitaIva || undefined,
  };
}

function formatNumeroOrdine(n: number): string {
  const year = new Date().getFullYear();
  return `ORD-${year}-${String(n).padStart(5, "0")}`;
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
    return NextResponse.json({ id: ref.id, numero: orderData.Numero as string });
  } catch (err) {
    console.error("[api/checkout/ordine]", err);
    return NextResponse.json({ error: "Errore nella creazione dell'ordine" }, { status: 500 });
  }
}
