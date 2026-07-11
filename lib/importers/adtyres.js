// Import ordini AdTyres (Fase 9, cutover Postgres-first in Fase 3 migrazione
// Ordini) — port 1:1 della Cloud Function `importadtyresorders` (crm-3iuocs,
// europe-west3), sorgente reale riscaricato da GCP (non dal repo locale
// SpieziaFunctions, verificato stale). Stessa logica: pull SFTP → parse XML →
// scrittura diretta su Postgres (core.ordini/ordine_articoli/clienti), stesso
// pattern di lib/importers/tyre24Anonimo.js. Il bridge esistente propaga
// automaticamente ogni riga verso Firestore per il CRM Flutter legacy.
//
// Differenze dal sorgente CF originale:
//  - Scrittura diretta su Postgres invece che Firestore (Fase 3, stesso
//    cutover già fatto per Tyre24/checkout/converti-preventivo).
//  - Idempotenza via PRIMARY KEY + `ON CONFLICT DO NOTHING` (core.ordini.id),
//    equivalente esatto del `.create()` Firestore usato in precedenza qui.
//  - Modalità `dryRun`: legge/parsa via SFTP ma non scrive né sposta i file
//    (nessun side-effect), usata per la finestra di verifica prima del
//    cutover.
//  - SFTP operato interamente in memoria (nessuna scrittura su disco locale —
//    il container è read_only con solo /tmp tmpfs 64MB).
//  - Scope NON coperto (decisione esplicita, stessa di tyre24PgWrite.js):
//    niente indirizzi salvati in rubrica cliente (Indirizzo_FatturazioneC/
//    SpedizioneC) — solo lo snapshot indirizzo sull'ordine stesso, che è il
//    campo che conta per il documento Firestore ricostruito dal bridge.

import SFTPClient from "ssh2-sftp-client";
import { parseStringPromise } from "xml2js";
import { adminDb } from "../firebase-admin";
import { isAlreadyExists } from "./util";
import { resolveOrCreateClientePg, insertOrderPg, orderExistsPg, insertCronologiaPg } from "./tyre24PgWrite";

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

// @returns {Promise<string>} cliente_id (esistente o appena creato)
async function processCustomer(billing, dryRun) {
  const ustid = t(billing.ustid);
  const name = t(billing.name);
  const customerId = ustid ? `ADT_${ustid}` : `ADT_${t(billing.kundennummer) || "unknown"}`;

  if (dryRun) return customerId;

  await resolveOrCreateClientePg(customerId, {
    nome: name,
    ragioneSociale: name,
    email: t(billing.email),
    telefono: t(billing.telefon),
    via: t(billing.strasse),
    citta: t(billing.ort),
    cap: t(billing.plz),
    paese: t(billing.lkz) || t(billing.land),
    partitaIva: ustid,
    codiceFiscale: t(billing.steuernummer),
    azienda: true,
    b2b: true,
    tipo: "B2B",
    source: "AdTyres",
  });
  return customerId;
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

// NB: risolve DELIBERATAMENTE via Firestore (non public.prodotti) — stesso
// motivo documentato in tyre24PgWrite.js::resolveArticlesPg (public.prodotti
// non è una migrazione diretta della collection Prodotti, ID diversi).
async function processArticles(db, positions, isItaly) {
  const articoli = [];
  const items = Array.isArray(positions) ? positions : [positions];

  for (const pos of items) {
    const sku = t(pos.artnr);
    const quantity = num(pos.menge);
    const unitPrice = num(pos.preis);
    const description = t(pos.bezeichnung);
    const ean = t(pos.ean);

    let refPath = null;
    let pfu = 0;
    let titolo = description;

    if (sku) {
      const snap = await db.collection("Prodotti").where("SKU", "==", sku).limit(1).get();
      if (!snap.empty) {
        const doc = snap.docs[0];
        refPath = doc.ref.path;
        const data = doc.data();
        pfu = isItaly ? (data.PFU || 0) : 0;
        titolo = data.Titolo || description;
      }
    }

    const totRiga = +(unitPrice * quantity).toFixed(2);
    articoli.push({
      ref_path: refPath,
      titolo,
      sku,
      contributo_logistico: 0,
      prezzo_unitario: unitPrice,
      quantita: quantity,
      pfu,
      tot_riga: totRiga,
      fs_extra: ean ? { EAN: ean } : {},
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

  const orderDate = new Date(t(order.bestelldatum));
  const billing = order.rechnungsadresse || {};
  const shipping = order.lieferadresse || {};
  const shippingCountry = t(shipping.lkz) || "";
  const isItaly = shippingCountry.toUpperCase() === "IT";

  // Fast-path idempotenza (come tyre24Anonimo.js): evita di risolvere
  // cliente/articoli per niente se l'ordine esiste già. La race residua è
  // chiusa dal PRIMARY KEY + ON CONFLICT dentro insertOrderPg, non da qui.
  if (dryRun) {
    const exists = await orderExistsPg(orderDocId);
    return { orderDocId, skipped: exists };
  }
  if (await orderExistsPg(orderDocId)) return { orderDocId, skipped: true };

  const clienteId = await processCustomer(billing, dryRun);
  const billingAddr = buildBillingAddress(billing);
  const shippingAddr = buildShippingAddress(shipping);

  const positions = order.positionen?.pos;
  const articoli = positions ? await processArticles(db, positions, isItaly) : [];

  const speseExtra = [];
  const shippingCost = num(order.versandkosten);
  if (shippingCost > 0) speseExtra.push({ Nome: "Spedizione", Importo: shippingCost });

  const totaleArticoli = articoli.reduce((s, a) => s + a.tot_riga, 0);
  const totalePFU = articoli.reduce((s, a) => s + a.pfu * a.quantita, 0);
  const totale = +(totaleArticoli + shippingCost).toFixed(2);

  const indirizzoSpedizione = {
    Via: shippingAddr.Via, Citta: shippingAddr.Citta, CAP: shippingAddr.CAP,
    Telefono: shippingAddr.Telefono, Destinatario: shippingAddr.Destinatario, Paese: shippingAddr.Paese,
  };
  const indirizzoFatturazione = {
    Via: billingAddr.Via, Citta: billingAddr.Citta, CAP: billingAddr.CAP,
    Telefono: billingAddr.Telefono, Destinatario: billingAddr.Destinatario, Paese: billingAddr.Paese,
  };

  let result;
  try {
    result = await insertOrderPg(
      orderDocId,
      {
        source: "AdTyres",
        stato: "In Lavorazione",
        clienteId,
        totale,
        iva: 0,
        pfu: +totalePFU.toFixed(2),
        pagamento: { Nome: "Bonifico Bancario", ID: "", Descrizione: "Bonifico Bancario", Costo: 0, Costo_Extra: 0 },
        indirizzoFatturazione,
        indirizzoSpedizione,
        note: t(order.bemerkung) || "",
        t24Country: null,
        dataOra: orderDate,
        createdAt: new Date(),
        fsExtra: {
          IsItaly: isItaly,
          Spese_Extra: speseExtra,
          ADT_OrderNumber: orderNumber,
          ADT_NeutralShipping: bool(order.neutralversand),
          ADT_ExpressShipping: bool(order.expressversand),
          ADT_InternalRemark: t(order.bemerkungintern) || "",
          ADT_BillingEmail: t(billing.email) || "",
          ADT_ShippingEmail: t(shipping.email) || "",
          ADT_FileName: fileName,
        },
      },
      articoli
    );
  } catch (err) {
    if (isAlreadyExists(err)) return { orderDocId, skipped: true };
    throw err;
  }

  if (result.skipped) return { orderDocId, skipped: true };

  await insertCronologiaPg(orderDocId, "Ordine importato automaticamente da AdTyres.");

  return { orderDocId, skipped: false };
}

/* ── entry point ──────────────────────────────────────────────────── */

// Un file che fallisce il parsing/scrittura resta in inbox e viene ritentato
// ad ogni run (corretto per un errore transitorio) — ma se il file è
// genuinamente malformato (root XML sbagliato, non un ordine reale), resta lì
// per sempre e si ri-tenta inutilmente ogni 15 minuti. Bug reale trovato il
// 2026-07-09: 4 file del 12 giugno bloccati in inbox da 75+ run consecutivi.
// Dopo questa soglia il file fallito viene spostato in inbox/errors/ (non
// cancellato — resta ispezionabile manualmente) invece di essere ritentato
// all'infinito.
const QUARANTINE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 giorni

/**
 * @param {{ force?: boolean, dryRun?: boolean }} [opts]
 */
export async function runAdtyresImport(opts = {}) {
  const { force = false, dryRun = false } = opts;
  const db = adminDb();
  const sftp = new SFTPClient();
  const result = { processedCount: 0, newCount: 0, updatedCount: 0, skippedCount: 0, quarantinedCount: 0, errors: [] };

  try {
    await sftp.connect({ host: SFTP_HOST, port: SFTP_PORT, username: SFTP_USER, password: SFTP_PASS, readyTimeout: 10000 });

    const cwd = await sftp.cwd();
    const base = cwd.replace(/\/+$/, "");
    const inboxDir = SFTP_DIR === "." ? base : SFTP_DIR;
    const processedDir = `${inboxDir}/processed`;
    const errorsDir = `${inboxDir}/errors`;

    if (!dryRun) {
      for (const dir of [processedDir, errorsDir]) {
        try {
          await sftp.mkdir(dir);
        } catch (err) {
          if (!String(err.message).toLowerCase().includes("exist")) throw err;
        }
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

    const now = Date.now();

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

        const age = file.modifyTime ? now - file.modifyTime : 0;
        if (!dryRun && age > QUARANTINE_AFTER_MS) {
          const errorDest = `${errorsDir}/${file.name}`;
          try {
            await sftp.rename(src, errorDest);
            result.quarantinedCount++;
          } catch { /* se anche lo spostamento fallisce, resta in inbox e si ritenta */ }
        }
        // Altrimenti il file resta in inbox → ritentato al prossimo run.
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
