import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createOrdine, resolveSedeId, resolvePersonaId } from "@/lib/ordiniDb";
import { checkAndDecrementFido, refundFido, listIndirizziCliente, createIndirizzoCliente, getClienteIdForUtente } from "@/lib/clientiDb";
import { newId } from "@/lib/db";
import { nextCounterServer } from "@/lib/countersDb";
import { listIndirizziUtente, createIndirizzoUtente, type IndirizzoTipo } from "@/lib/utentiIndirizziDb";
import { sendOrdineEmail } from "@/lib/email/ordineEmail";
import { getRappresentanteForUtente } from "@/lib/rappresentanteDb";

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
// Il numero ordine è allocato tramite lib/countersDb.ts::nextCounterServer,
// la stessa logica/flag di lib/counters.ts (NEXT_PUBLIC_COUNTERS_ORDINE_BACKEND)
// ma chiamata direttamente (niente self-fetch, impossibile da un Route
// Handler con URL relativo). Di default (flag spento) alloca ancora da
// Firestore Counters/{sedeId} — invariato finché il CRM Flutter legacy crea
// ordini con numerazione propria e quel documento resta l'unico punto di
// serializzazione condiviso.

interface AddressPayload {
  nome: string; via: string; cap: string; citta: string; provincia: string; partitaIva: string;
}
interface ArticoloPayload {
  id: string; marca: string; modello: string; misura?: string; quantita: number;
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

// Salva l'indirizzo inserito nella rubrica del cliente (core.clienti_indirizzi,
// decommissioning finale Firebase — sostituisce
// Clienti/{id}/Indirizzo_FatturazioneC, già bridgeata bidirezionalmente), in
// modalità "ordina per conto di" (ramo forClient sotto), se non è già
// presente — così il prossimo ordine può riusarlo dal menu "Usa un indirizzo
// salvato". Best-effort: un fallimento qui non deve far fallire l'ordine, già
// creato con successo a questo punto.
async function saveAddressIfNewCliente(
  clienteId: string,
  doc: { Azienda: string; Via: string; CAP: string; Citta: string; Provincia: string; Partita_Iva: string | null }
): Promise<void> {
  try {
    const existing = await listIndirizziCliente(clienteId, "fatturazione");
    const key = normalizeAddr(doc);
    const alreadySaved = existing.some((a) => normalizeAddr(a) === key);
    if (alreadySaved) return;
    await createIndirizzoCliente(clienteId, "fatturazione", doc);
  } catch (err) {
    console.error("[api/checkout/ordine] salvataggio indirizzo cliente fallito (non bloccante):", err);
  }
}

// Salva l'indirizzo self-checkout nella rubrica Postgres dell'utente
// (core.utenti_indirizzi via lib/utentiIndirizziDb.ts, stessa tabella letta
// da /api/account/indirizzi in "I miei indirizzi"), se non è già presente —
// stesso pattern/stessa dedupe di saveAddressIfNew sopra, solo verso
// Postgres invece di Firestore. Sostituisce la vecchia scrittura diretta su
// users/{uid}/Indirizzo_Fatturazione (Firestore, mai bridgeata e mai più
// letta da nessuna pagina dopo il cutover di account/page.tsx): un cliente
// che salvava un indirizzo al checkout self-service non lo rivedeva più in
// "I miei indirizzi". Best-effort per lo stesso motivo del resto della route.
async function saveAddressIfNewPg(
  utenteId: string,
  tipo: IndirizzoTipo,
  a: AddressPayload
): Promise<void> {
  try {
    const key = normalizeAddr({ Via: a.via, CAP: a.cap, Citta: a.citta });
    const existing = await listIndirizziUtente(utenteId, tipo);
    const alreadySaved = existing.some(
      (ind) => normalizeAddr({ Via: ind.Via, CAP: ind.CAP, Citta: ind.Citta }) === key
    );
    if (alreadySaved) return;
    await createIndirizzoUtente(utenteId, tipo, {
      Nome: a.nome,
      Via: a.via,
      CAP: a.cap,
      Citta: a.citta,
      Provincia: a.provincia,
      Partita_Iva: a.partitaIva || undefined,
    });
  } catch (err) {
    console.error("[api/checkout/ordine] salvataggio indirizzo (Postgres) fallito (non bloccante):", err);
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

  const sedeId = body.sedeId || "main";
  const forClient = canOrderForClient && !!body.clienteId;

  // Self-service (cliente che ordina per sé, non "per conto di"): se ha
  // un'anagrafica core.clienti collegata, il fido autoritativo vive lì
  // (vedi commento in lib/clientiDb.ts::getClienteIdForUtente) — prima si
  // controllava sempre core.utenti, che per questi account resta null per
  // sempre, quindi NESSUN blocco fido veniva mai applicato a un cliente con
  // anagrafica propria che ordinava da sé.
  const linkedClienteId = forClient ? null : await getClienteIdForUtente(session.uid);
  const fidoTable = forClient || linkedClienteId ? "clienti" : "utenti";
  const fidoId = forClient ? (body.clienteId as string) : (linkedClienteId ?? session.uid);

  // Check+scalo atomico del fido (chiude la finestra TOCTOU del vecchio
  // check-poi-decrementa in due passaggi separati). Va PRIMA della creazione
  // ordine: se l'ordine fallisce dopo, il fido va riaccreditato (vedi catch).
  const fidoResult = await checkAndDecrementFido(fidoTable, fidoId, body.totale);
  if (!fidoResult.ok) {
    // Rappresentante per il messaggio di blocco: core.clienti non lo
    // popola mai (verificato: 0 righe su 10485) — resta sempre core.utenti,
    // anche quando il fido stesso è stato controllato su core.clienti.
    const rappresentante = linkedClienteId
      ? await getRappresentanteForUtente(session.uid)
      : fidoResult.rappresentante;
    return NextResponse.json(
      { error: fidoBlockedError(forClient, rappresentante), code: "ORDER_BLOCKED" },
      { status: 403 }
    );
  }

  try {
    // Allocazione centralizzata (vedi commento in testa al file) — stesso
    // punto di serializzazione condiviso con il CRM Flutter legacy.
    const numero = await nextCounterServer("Ordine", sedeId);
    const numeroDisplay = formatNumeroOrdine(numero);
    // core.ordini ha FK (NOT VALID sulle righe storiche, ma applicate su ogni
    // nuovo insert) verso sedi/utenti/clienti — "main" (fallback lato client
    // per il solo Counters Firestore) non è mai un id sede reale, e una
    // sessione legacy via fallback Firebase può referenziare un utente non
    // ancora sincronizzato su Postgres dal bridge. Risolti prima dell'insert
    // per non far fallire l'intero checkout; l'uid originale resta comunque
    // in fs_extra se non risolvibile.
    const [pgSedeId, pgUtenteId, pgClienteId] = await Promise.all([
      resolveSedeId(sedeId),
      resolvePersonaId("utenti", session.uid),
      forClient ? resolvePersonaId("clienti", body.clienteId) : Promise.resolve(null),
    ]);

    // externalOrderId = id (stesso pattern di lib/importers/tyre24PgWrite.js):
    // è il campo "BDA" letto da lib/gls/sdk.js per creare la spedizione GLS —
    // senza, "Crea GLS" fallisce con "missing the ID field required for BDA"
    // per QUALSIASI ordine nato da checkout (gap mai notato finché non si è
    // provato a spedire un ordine B2B nativo invece che uno importato).
    const orderId = newId();
    const { id } = await createOrdine({
      id: orderId,
      externalOrderId: orderId,
      numero,
      numeroDisplay,
      source: "B2B",
      stato: "In Preparazione",
      sedeId: pgSedeId,
      utenteId: pgUtenteId,
      clienteId: forClient ? pgClienteId : null,
      createdBy: forClient ? session.uid : null,
      totale: body.totale,
      iva: body.iva,
      pfu: body.pfu,
      scontoTotale: body.scontoTotale,
      contributoLogistico: body.contributoLogistico,
      pagamento: { Metodo: "Da definire", Stato: "In attesa" },
      indirizzoFatturazione: addr(body.fatturazione),
      indirizzoSpedizione: addr(body.spedizione ?? body.fatturazione),
      fsExtra: {
        ...(pgUtenteId ? {} : { UtenteUid: session.uid }),
        ...(forClient && !pgClienteId ? { ClienteUid: body.clienteId } : {}),
      },
      articoli: body.articoli.map((i) => ({
        // SOLO modello (+misura) — MAI prefissato con la marca: sia la pagina
        // admin ordini (app/(admin)/admin/ordini/[id]/page.tsx) sia l'email
        // ordine (lib/email/ordineEmail.ts) prependono già `Marca` da sola,
        // come fa anche il report "prodotti più venduti" (lib/ordiniDb.ts) —
        // un titolo che include la marca la duplicherebbe ovunque ("Compasal
        // Compasal Blazer HP"). La misura (mai passata prima d'ora — persa
        // dal carrello, che la cattura già in `i.misura`, fino a qui) è
        // l'unico dato pneumatico-identificativo mancante dalla card ordine
        // admin: senza, la riga sembra "scollegata dal prodotto" (bug
        // segnalato dall'utente).
        titolo: [i.modello, i.misura].filter(Boolean).join(" ").trim(),
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
    if (forClient && pgClienteId) {
      const clienteAddr = (a: AddressPayload) => ({
        Azienda: a.nome, Via: a.via, CAP: a.cap, Citta: a.citta,
        Provincia: a.provincia, Partita_Iva: a.partitaIva || null,
      });
      await saveAddressIfNewCliente(pgClienteId, clienteAddr(body.fatturazione));
      if (body.spedizione && normalizeAddr(clienteAddr(body.spedizione)) !== normalizeAddr(clienteAddr(body.fatturazione))) {
        await saveAddressIfNewCliente(pgClienteId, clienteAddr(body.spedizione));
      }
    } else if (!forClient) {
      await saveAddressIfNewPg(session.uid, "fatturazione", body.fatturazione);
      if (body.spedizione && normalizeAddr({ Via: body.spedizione.via, CAP: body.spedizione.cap, Citta: body.spedizione.citta })
          !== normalizeAddr({ Via: body.fatturazione.via, CAP: body.fatturazione.cap, Citta: body.fatturazione.citta })) {
        await saveAddressIfNewPg(session.uid, "spedizione", body.spedizione);
      }
    }

    // Fire-and-forget: un'email fallita non deve mai invalidare un ordine già
    // creato con successo (vedi commento in testa a lib/email/ordineEmail.ts).
    sendOrdineEmail(id).catch((err) => {
      console.error("[api/checkout/ordine] invio email ordine fallito (non bloccante):", err);
    });

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
