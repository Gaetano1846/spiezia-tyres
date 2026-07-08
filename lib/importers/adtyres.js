// Import ordini AdTyres (Fase 9) — port 1:1 della Cloud Function
// `importadtyresorders` (crm-3iuocs, europe-west3), sorgente reale riscaricato
// da GCP (non dal repo locale SpieziaFunctions, verificato stale). Stessa
// logica: pull SFTP → parse XML → scrittura Ordini/Clienti su Firestore via
// Admin SDK. Il bridge esistente sincronizza su Postgres, nessuna modifica.
//
// Differenze dal sorgente CF originale:
//  - `Ordini.doc(id).create()` invece di `.get()`+`.set()` — chiude la finestra
//    TOCTOU dell'idempotenza (vedi Fase 9 del piano).
//  - Modalità `dryRun`: legge/parsa via SFTP ma non scrive né su Firestore né
//    sposta i file (nessun side-effect), usata per la finestra di verifica
//    prima del cutover.
//  - SFTP operato interamente in memoria (nessuna scrittura su disco locale —
//    il container è read_only con solo /tmp tmpfs 64MB).

import SFTPClient from "ssh2-sftp-client";
import { parseStringPromise } from "xml2js";
import { adminDb } from "../firebase-admin";

const SFTP_HOST = process.env.ADTYRES_ORDERS_SFTP_HOST || "";
const SFTP_USER = process.env.ADTYRES_ORDERS_SFTP_USER || "";
const SFTP_PASS = process.env.ADTYRES_ORDERS_SFTP_PASSWORD || "";
const SFTP_PORT = Number(process.env.ADTYRES_ORDERS_SFTP_PORT || 22);
const SFTP_DIR = process.env.ADTYRES_ORDERS_SFTP_DIR || ".";

const META_REF = () => adminDb().collection("exports").doc("adTyresOrdersImport");

/* ── helpers ──────────────────────────────────────────────────────── */

function t(node) {
  if (!node) return "";
  if (Array.isArray(node)) return t(node[0]);
  if (typeof node === "object" && node._) return String(node._).trim();
  return String(node).trim();
}

function num(node) {
  const v = parseFloat(t(node));
  return Number.isFinite(v) ? v : 0;
}

function bool(node) {
  const s = t(node).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

/* ── customer processing ─────────────────────────────────────────── */

async function processCustomer(db, billing, dryRun) {
  const ustid = t(billing.ustid);
  const name = t(billing.name);
  const customerId = ustid ? `ADT_${ustid}` : `ADT_${t(billing.kundennummer) || "unknown"}`;
  const customerRef = db.collection("Clienti").doc(customerId);

  if (dryRun) return customerRef;

  const existing = await customerRef.get();
  if (existing.exists) return customerRef;

  const customerData = {
    ID: customerId,
    Nome: name,
    Ragione_Sociale: name,
    Email: t(billing.email),
    Telefono: t(billing.telefon),
    Via: t(billing.strasse),
    Citta: t(billing.ort),
    CAP: t(billing.plz),
    Paese: t(billing.lkz) || t(billing.land),
    Partita_Iva: ustid,
    Codice_Fiscale: t(billing.steuernummer),
    Azienda: true,
    B2B: true,
    Tipo: "B2B",
    Source: "AdTyres",
    CreatedAt: new Date(),
  };

  await customerRef.set(customerData);
  return customerRef;
}

/* ── address processing ──────────────────────────────────────────── */

async function ensureAddress(clienteRef, subcollection, addressData, dryRun) {
  if (dryRun) return null;

  const existing = await clienteRef.collection(subcollection)
    .where("Destinatario", "==", addressData.Destinatario)
    .where("Via", "==", addressData.Via)
    .where("CAP", "==", addressData.CAP)
    .where("Citta", "==", addressData.Citta)
    .where("Paese", "==", addressData.Paese)
    .limit(1)
    .get();

  if (!existing.empty) return existing.docs[0].ref;

  return clienteRef.collection(subcollection).add(addressData);
}

function buildBillingAddress(billing) {
  const dest = t(billing.name);
  return {
    Nome: `Fatturazione - ${dest}`,
    Destinatario: dest,
    Via: t(billing.strasse),
    CAP: t(billing.plz),
    Citta: t(billing.ort),
    Paese: t(billing.lkz) || t(billing.land),
    Telefono: t(billing.telefon),
  };
}

function buildShippingAddress(shipping) {
  const dest = t(shipping.name);
  const phone = t(shipping.telefon) || t(shipping.name2);
  return {
    Nome: `Spedizione - ${dest}`,
    Destinatario: dest,
    Via: t(shipping.strasse),
    CAP: t(shipping.plz),
    Citta: t(shipping.ort),
    Paese: t(shipping.lkz) || t(shipping.land),
    Telefono: phone,
  };
}

/* ── article processing ──────────────────────────────────────────── */

async function processArticles(db, positions, isItaly) {
  const articoli = [];
  const items = Array.isArray(positions) ? positions : [positions];

  for (const pos of items) {
    const sku = t(pos.artnr);
    const quantity = num(pos.menge);
    const unitPrice = num(pos.preis);
    const description = t(pos.bezeichnung);
    const ean = t(pos.ean);

    let prodottoRef = null;
    let pfu = 0;
    let titolo = description;

    if (sku) {
      const snap = await db.collection("Prodotti").where("SKU", "==", sku).limit(1).get();
      if (!snap.empty) {
        const doc = snap.docs[0];
        prodottoRef = doc.ref;
        const data = doc.data();
        pfu = isItaly ? (data.PFU || 0) : 0;
        titolo = data.Titolo || description;
      }
    }

    articoli.push({
      Ref: prodottoRef,
      Titolo: titolo,
      SKU: sku,
      EAN: ean,
      Contributo_Logistico: 0,
      Prezzo: unitPrice,
      Quantita: quantity,
      PFU: pfu,
      Prezzo_Totale: +(unitPrice * quantity).toFixed(2),
      PFU_Totale: +(pfu * quantity).toFixed(2),
    });
  }

  return articoli;
}

/* ── single XML order processing ─────────────────────────────────── */

// Esportata (oltre che usata internamente) per il test di idempotenza —
// esercita la logica reale di parsing/scrittura senza passare dal vero SFTP
// AD Tyres (inbox di un partner reale, non un ambiente di test).
export async function processXmlOrder(db, xmlContent, fileName, dryRun) {
  const parsed = await parseStringPromise(xmlContent, { explicitArray: false, trim: true });
  const order = parsed.bestellung;
  if (!order) throw new Error(`No <bestellung> root in ${fileName}`);

  const orderNumber = t(order.bestellnummer);
  const orderDocId = `ADT-${orderNumber}`;
  const orderRef = db.collection("Ordini").doc(orderDocId);

  const orderDate = new Date(t(order.bestelldatum));
  const billing = order.rechnungsadresse || {};
  const shipping = order.lieferadresse || {};
  const shippingCountry = t(shipping.lkz) || "";
  const isItaly = shippingCountry.toUpperCase() === "IT";

  const clienteRef = await processCustomer(db, billing, dryRun);
  const billingAddr = buildBillingAddress(billing);
  const shippingAddr = buildShippingAddress(shipping);
  await ensureAddress(clienteRef, "Indirizzo_FatturazioneC", billingAddr, dryRun);
  await ensureAddress(clienteRef, "Indirizzo_SpedizioneC", shippingAddr, dryRun);

  const positions = order.positionen?.pos;
  const articoli = positions ? await processArticles(db, positions, isItaly) : [];

  const speseExtra = [];
  const shippingCost = num(order.versandkosten);
  if (shippingCost > 0) speseExtra.push({ Nome: "Spedizione", Importo: shippingCost });

  const totaleArticoli = articoli.reduce((s, a) => s + a.Prezzo_Totale, 0);
  const totalePFU = articoli.reduce((s, a) => s + a.PFU_Totale, 0);
  const totale = +(totaleArticoli + shippingCost).toFixed(2);

  const orderDoc = {
    ID: orderDocId,
    DataOra: orderDate,
    Stato: "In Lavorazione",
    Articoli: articoli,
    Spese_Extra: speseExtra,
    Totale: totale,
    IVA: 0,
    PFU: +totalePFU.toFixed(2),
    Cliente: clienteRef,
    Indirizzo_Spedizione: {
      Via: shippingAddr.Via, Citta: shippingAddr.Citta, CAP: shippingAddr.CAP,
      Telefono: shippingAddr.Telefono, Destinatario: shippingAddr.Destinatario, Paese: shippingAddr.Paese,
    },
    Indirizzo_Fatturazione: {
      Via: billingAddr.Via, Citta: billingAddr.Citta, CAP: billingAddr.CAP,
      Telefono: billingAddr.Telefono, Destinatario: billingAddr.Destinatario, Paese: billingAddr.Paese,
    },
    Pagamento: { Nome: "Bonifico Bancario", ID: "", Descrizione: "Bonifico Bancario", Costo: 0, Costo_Extra: 0 },
    Note: t(order.bemerkung) || "",
    CreatedAt: new Date(),
    Source: "AdTyres",
    IsItaly: isItaly,
    ADT_OrderNumber: orderNumber,
    ADT_NeutralShipping: bool(order.neutralversand),
    ADT_ExpressShipping: bool(order.expressversand),
    ADT_InternalRemark: t(order.bemerkungintern) || "",
    ADT_BillingEmail: t(billing.email) || "",
    ADT_ShippingEmail: t(shipping.email) || "",
    ADT_FileName: fileName,
  };

  if (dryRun) {
    // In dry-run non sappiamo se il documento esiste già senza leggerlo (qui va
    // bene farlo: nessuna scrittura segue, niente finestra TOCTOU da chiudere).
    const existing = await orderRef.get();
    return { orderDocId, skipped: existing.exists };
  }

  try {
    await orderRef.create(orderDoc);
  } catch (err) {
    // ALREADY_EXISTS (grpc code 6 / http 409) → altro run ha già creato l'ordine.
    if (err?.code === 6 || err?.code === "already-exists" || /already exists/i.test(err?.message ?? "")) {
      return { orderDocId, skipped: true };
    }
    throw err;
  }

  await orderRef.collection("Cronologia").add({
    Data: new Date(),
    Descrizione: "Ordine importato automaticamente da AdTyres.",
  });

  return { orderDocId, skipped: false };
}

/* ── entry point ──────────────────────────────────────────────────── */

/**
 * @param {{ force?: boolean, dryRun?: boolean }} [opts]
 */
export async function runAdtyresImport(opts = {}) {
  const { force = false, dryRun = false } = opts;
  const db = adminDb();
  const sftp = new SFTPClient();
  const result = { processedCount: 0, newCount: 0, updatedCount: 0, skippedCount: 0, errors: [] };

  try {
    await sftp.connect({ host: SFTP_HOST, port: SFTP_PORT, username: SFTP_USER, password: SFTP_PASS, readyTimeout: 10000 });

    const cwd = await sftp.cwd();
    const base = cwd.replace(/\/+$/, "");
    const inboxDir = SFTP_DIR === "." ? base : SFTP_DIR;
    const processedDir = `${inboxDir}/processed`;

    if (!dryRun) {
      try {
        await sftp.mkdir(processedDir);
      } catch (err) {
        if (!String(err.message).toLowerCase().includes("exist")) throw err;
      }
    }

    const inboxList = await sftp.list(inboxDir);
    const inboxFiles = inboxList
      .filter((f) => f.type === "-" && f.name.toLowerCase().endsWith(".xml"))
      .map((f) => ({ file: f, src: `${inboxDir}/${f.name}`, dest: `${processedDir}/${f.name}` }));

    let filesToProcess = inboxFiles;
    if (force) {
      const processedList = await sftp.list(processedDir).catch(() => []);
      const processedFiles = processedList
        .filter((f) => f.type === "-" && f.name.toLowerCase().endsWith(".xml"))
        .map((f) => ({ file: f, src: `${processedDir}/${f.name}`, dest: `${processedDir}/${f.name}` }));
      filesToProcess = [...inboxFiles, ...processedFiles];
    }

    for (const { file, src, dest } of filesToProcess) {
      try {
        const xmlBuffer = await sftp.get(src);
        const xmlContent = xmlBuffer.toString("utf8");
        const { orderDocId, skipped } = await processXmlOrder(db, xmlContent, file.name, dryRun);

        if (!dryRun && src !== dest) await sftp.rename(src, dest);

        result.processedCount++;
        if (skipped) result.skippedCount++;
        else result.newCount++;
        void orderDocId;
      } catch (err) {
        result.errors.push({ id: file.name, message: err instanceof Error ? err.message : String(err) });
        // Il file resta in inbox (non rinominato) → ritentato al prossimo run.
      }
    }

    if (!dryRun) {
      await META_REF().set({ lastRun: new Date() }, { merge: true });
    }
  } finally {
    try { await sftp.end(); } catch { /* ignore */ }
  }

  return result;
}
