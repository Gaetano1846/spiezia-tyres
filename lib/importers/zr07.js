// Import ordini 07ZR/Distri2B (Italia/Francia/Germania/Austria) — stesso
// gruppo/rete del catalogo esportato dal repo Prezzo-Gomme
// (scripts/export-pipeline/export-07zr.mjs, VPS-native, progetto diverso da
// questo); qui invece leggiamo gli ordini XML che arrivano nella cartella
// orders/ di ciascuno dei 4 account FTP e li scriviamo su core.ordini in
// QUESTO repo — stesso schema/stesso pattern di lib/importers/adtyres.js —
// perché sono ordini reali di dealer che comprano da noi, vanno lavorati
// come qualsiasi altro ordine marketplace (AdTyres/Tyre24/Woo/eBay), non
// nella pipeline di export catalogo.
//
// Differenza principale da AdTyres: qui il trasporto è FTP semplice
// (basic-ftp, stessa libreria già usata per l'upload catalogo in
// lib/catalogExport/adtyresCsv.js), non SFTP — e sono 4 account separati
// (uno per mercato) da interrogare ad ogni run, non uno solo.
//
// Formato XML verificato su un ordine reale (2026-05-09_434359904.xml,
// scaricato manualmente dall'account Italia, 2026-08-09): root
// <order distributor="1280" ordernumber="..." creationdate="..."
// deliverydate="..." version="9.0.0">, <products><tyres> con un <tyre> per
// riga (scope limitato a tyres — stesso scope di AdTyres/del nostro export
// catalogo, che vende solo pneumatici; rims/batteries/oils/etc. compaiono
// nel DTD ma restano sempre vuoti per noi), <customer> con indirizzo
// fatturazione+spedizione separati (invoice*/delivery*).
//
// Match articolo: <codedistributor> nell'XML è il NOSTRO sku (lo stesso
// valore mandato nella colonna "ID Art. frs" del CSV catalogo) — verificato
// 2026-08-09 contro public.prodotti (Bridgestone 235/75 R17.5, EAN
// combaciante: 3286341326314). Risolto via Firestore Prodotti.SKU come
// AdTyres — stesso motivo documentato lì: il bridge verso Firestore per il
// CRM Flutter legacy si aspetta un ref_path reale, non un id public.prodotti.
//
// Cliente: id deterministico ZR07_{partitaIva} (fallback
// ZR07_{distributor}_{customerNo} se manca la P.IVA, namespaced per evitare
// collisioni tra mercati) — stesso schema di ADT_{ustid} in adtyres.js.
//
// source: sempre "07ZR" per tutti e 4 i mercati (deciso con l'utente
// 2026-08-09) — il mercato (IT/FR/DE/AT) va nella colonna t24_country
// (riusata: generica nonostante il nome, già nullable e mai popolata da
// AdTyres/Woo/eBay) così resta filtrabile senza una migration.
//
// IVA: qui l'XML fornisce totalht/tva/totalttc espliciti — a differenza di
// AdTyres (iva sempre 0 lì), qui la popoliamo per davvero.
//
// PFU: <fee type="ecotaxesystemfee"> nell'XML è il totale ordine, non
// scomposto per riga — per il valore per-riga riusiamo comunque il lookup
// Firestore per SKU (stesso campo PFU di AdTyres), più coerente con come lo
// calcolano gli altri importer piuttosto che fidarsi di un totale non
// scomponibile per articolo.
//
// Pagamento: <payment type="SEPA"> con IBAN/banca/mandato SEPA completi —
// messi in fs_extra (ZR07_Payment) invece che nel campo pagamento condiviso,
// per non toccare la forma minimale (Nome/ID/Descrizione/Costo) che il resto
// della UI si aspetta da quel campo.

import { Client as FtpClient } from "basic-ftp";
import { Writable } from "node:stream";
import { parseStringPromise } from "xml2js";
import { adminDb } from "../firebase-admin";
import { isAlreadyExists } from "./util";
import { resolveOrCreateClientePg, insertOrderPg, orderExistsPg, insertCronologiaPg } from "./tyre24PgWrite";

const MARKETS = [
  { country: "IT", distributor: "1280", envPrefix: "ZR07_IT", label: "07ZR" },
  { country: "FR", distributor: "1858", envPrefix: "ZR07_FR", label: "Distri2B" },
  { country: "DE", distributor: "2229", envPrefix: "ZR07_DE", label: "07ZR" },
  { country: "AT", distributor: "2230", envPrefix: "ZR07_AT", label: "07ZR" },
];

// Stessa soglia di adtyres.js — un file genuinamente malformato non deve
// essere ritentato all'infinito ad ogni run.
const QUARANTINE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 giorni

/* ── helpers (identici a adtyres.js, per coerenza col parsing xml2js) ── */

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

function attr(node, name) {
  return node?.$?.[name] ?? "";
}

/* ── customer processing ─────────────────────────────────────────── */

async function processCustomer(customer, distributor, dryRun) {
  const partitaIva = t(customer.notva);
  const customerNo = t(customer.no);
  const customerId = partitaIva ? `ZR07_${partitaIva}` : `ZR07_${distributor}_${customerNo || "unknown"}`;

  if (dryRun) return customerId;

  await resolveOrCreateClientePg(customerId, {
    nome: t(customer.name),
    ragioneSociale: t(customer.name),
    email: t(customer.email),
    telefono: t(customer.phone) || t(customer.mobile),
    via: t(customer.street1),
    citta: t(customer.cityname),
    cap: t(customer.zipcode),
    paese: t(customer.country),
    partitaIva,
    codiceFiscale: t(customer.siret),
    azienda: true,
    b2b: true,
    tipo: "B2B",
    source: "07ZR",
  });
  return customerId;
}

function buildBillingAddress(customer) {
  return {
    Via: t(customer.invoicestreet1),
    Citta: t(customer.invoicecityname),
    CAP: t(customer.invoicezipcode),
    Telefono: t(customer.invoicecontactphone) || t(customer.phone),
    Destinatario: t(customer.invoicename) || t(customer.invoicecontact),
    Paese: t(customer.invoicecountry) || t(customer.country),
  };
}

function buildShippingAddress(customer) {
  return {
    Via: t(customer.deliverystreet1),
    Citta: t(customer.deliverycityname),
    CAP: t(customer.deliveryzipcode),
    Telefono: t(customer.deliverycontactphone) || t(customer.phone),
    Destinatario: t(customer.deliveryname) || t(customer.deliverycontact),
    Paese: t(customer.deliverycountry) || t(customer.country),
  };
}

/* ── article processing ──────────────────────────────────────────── */

async function processArticles(db, tyres) {
  const articoli = [];
  const items = Array.isArray(tyres) ? tyres : [tyres];

  for (const item of items) {
    const sku = t(item.codedistributor);
    const quantity = num(item.quantity);
    const unitPrice = num(item.unitprice);
    const description = t(item.name);
    const ean = t(item.ean);

    let refPath = null;
    let pfu = 0;
    let titolo = description;

    if (sku) {
      const snap = await db.collection("Prodotti").where("SKU", "==", sku).limit(1).get();
      if (!snap.empty) {
        const doc = snap.docs[0];
        refPath = doc.ref.path;
        const data = doc.data();
        pfu = data.PFU || 0;
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

// Esportata (oltre che usata internamente) per test di idempotenza, stesso
// motivo di adtyres.js::processXmlOrder.
export async function processXmlOrder(db, xmlContent, fileName, market, dryRun) {
  const parsed = await parseStringPromise(xmlContent, { explicitArray: false, trim: true });
  const order = parsed.order;
  if (!order) throw new Error(`No <order> root in ${fileName}`);

  const orderNumber = attr(order, "ordernumber");
  if (!orderNumber) throw new Error(`Missing ordernumber attribute in ${fileName}`);
  const orderDocId = `ZR07-${orderNumber}`;
  const distributor = attr(order, "distributor") || market.distributor;
  const creationDateRaw = attr(order, "creationdate");
  const creationDate = creationDateRaw ? new Date(creationDateRaw) : new Date();

  // Fast-path idempotenza (come adtyres.js/tyre24Anonimo.js): evita di
  // risolvere cliente/articoli per niente se l'ordine esiste già.
  if (dryRun) {
    const exists = await orderExistsPg(orderDocId);
    return { orderDocId, skipped: exists };
  }
  if (await orderExistsPg(orderDocId)) return { orderDocId, skipped: true };

  const products = order.products || {};
  const customer = order.customer || {};

  const clienteId = await processCustomer(customer, distributor, dryRun);
  const billingAddr = buildBillingAddress(customer);
  const shippingAddr = buildShippingAddress(customer);

  const tyres = products.tyres?.tyre;
  const articoli = tyres ? await processArticles(db, tyres) : [];

  const feesRaw = products.fees?.fee;
  const fees = feesRaw ? (Array.isArray(feesRaw) ? feesRaw : [feesRaw]) : [];
  const feeValue = (type) => {
    const fee = fees.find((f) => attr(f, "type") === type);
    return fee ? num(fee) : 0;
  };
  const shippingCost = feeValue("deliveryfees") + feeValue("deliveryaddressfees") + feeValue("deliverysystemfees");
  const ecotax = feeValue("ecotaxesystemfee");

  const totaleArticoli = articoli.reduce((s, a) => s + a.tot_riga, 0);
  const totalePFU = articoli.reduce((s, a) => s + a.pfu * a.quantita, 0);
  const totale = num(products.totalttc) || +(totaleArticoli + shippingCost).toFixed(2);
  const iva = num(products.tva);

  const speseExtra = [];
  if (shippingCost > 0) speseExtra.push({ Nome: "Spedizione", Importo: shippingCost });

  const payment = products.payment || {};
  const bank = payment.customerbank || {};

  let result;
  try {
    result = await insertOrderPg(
      orderDocId,
      {
        source: "07ZR",
        stato: "In Lavorazione",
        clienteId,
        totale,
        iva,
        pfu: +totalePFU.toFixed(2),
        pagamento: { Nome: "Bonifico SEPA", ID: "", Descrizione: "Bonifico SEPA", Costo: 0, Costo_Extra: 0 },
        indirizzoFatturazione: billingAddr,
        indirizzoSpedizione: shippingAddr,
        note: "",
        t24Country: market.country,
        dataOra: creationDate,
        createdAt: new Date(),
        fsExtra: {
          Spese_Extra: speseExtra,
          ZR07_OrderNumber: orderNumber,
          ZR07_Distributor: distributor,
          ZR07_Market: market.country,
          ZR07_Label: market.label,
          ZR07_DeliveryDate: attr(order, "deliverydate"),
          ZR07_Ecotax: ecotax,
          ZR07_CustomerNo: t(customer.no),
          ZR07_Payment: {
            Type: attr(payment, "type"),
            BankName: t(bank.bankname),
            Iban: t(bank.bankiban),
            Swift: t(bank.bankswift),
            MandateReference: t(bank.sepa_mandate_reference),
            MandateDate: t(bank.sepa_mandate_date),
          },
          ZR07_FileName: fileName,
        },
      },
      articoli
    );
  } catch (err) {
    if (isAlreadyExists(err)) return { orderDocId, skipped: true };
    throw err;
  }

  if (result.skipped) return { orderDocId, skipped: true };

  await insertCronologiaPg(orderDocId, `Ordine importato automaticamente da 07ZR (${market.label} ${market.country}).`);

  return { orderDocId, skipped: false };
}

/* ── FTP transport, un giro per mercato ─────────────────────────── */

function collectToBuffer() {
  const chunks = [];
  const writable = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  return { writable, getBuffer: () => Buffer.concat(chunks) };
}

async function runMarket(db, market, dryRun, force) {
  const host = process.env[`${market.envPrefix}_FTP_HOST`];
  const user = process.env[`${market.envPrefix}_FTP_USER`];
  const password = process.env[`${market.envPrefix}_FTP_PASSWORD`];
  const result = { processedCount: 0, newCount: 0, updatedCount: 0, skippedCount: 0, quarantinedCount: 0, errors: [] };

  if (!host || !user || !password) {
    result.errors.push({ id: market.country, message: `${market.envPrefix}_FTP_HOST/USER/PASSWORD mancanti` });
    return result;
  }

  const ordersDir = "/orders";
  const processedDir = "/orders/processed";
  const errorsDir = "/orders/errors";

  const client = new FtpClient();
  client.ftp.verbose = false;
  try {
    await client.access({ host, user, password, secure: false });

    if (!dryRun) {
      for (const dir of [processedDir, errorsDir]) {
        try {
          await client.ensureDir(dir);
        } catch { /* già esistente, o la creazione fallisce e lo scopriamo comunque sotto */ }
      }
      await client.cd("/");
    }

    const inboxList = await client.list(ordersDir);
    const inboxFiles = inboxList.filter((f) => f.isFile && f.name.toLowerCase().endsWith(".xml"));
    let filesToProcess = inboxFiles.map((f) => ({ file: f, src: `${ordersDir}/${f.name}`, dest: `${processedDir}/${f.name}` }));

    if (force) {
      const processedList = await client.list(processedDir).catch(() => []);
      const processedFiles = processedList
        .filter((f) => f.isFile && f.name.toLowerCase().endsWith(".xml"))
        .map((f) => ({ file: f, src: `${processedDir}/${f.name}`, dest: `${processedDir}/${f.name}` }));
      filesToProcess = [...filesToProcess, ...processedFiles];
    }

    const now = Date.now();

    for (const { file, src, dest } of filesToProcess) {
      try {
        const { writable, getBuffer } = collectToBuffer();
        await client.downloadTo(writable, src);
        const xmlContent = getBuffer().toString("utf8");
        const { orderDocId, skipped } = await processXmlOrder(db, xmlContent, file.name, market, dryRun);

        if (!dryRun && src !== dest) await client.rename(src, dest);

        result.processedCount++;
        if (skipped) result.skippedCount++;
        else result.newCount++;
        void orderDocId;
      } catch (err) {
        result.errors.push({ id: `${market.country}/${file.name}`, message: err instanceof Error ? err.message : String(err) });

        const age = file.modifiedAt ? now - file.modifiedAt.getTime() : 0;
        if (!dryRun && age > QUARANTINE_AFTER_MS) {
          try {
            await client.rename(src, `${errorsDir}/${file.name}`);
            result.quarantinedCount++;
          } catch { /* se anche lo spostamento fallisce, resta in inbox e si ritenta */ }
        }
        // Altrimenti il file resta in orders/ → ritentato al prossimo run.
      }
    }
  } finally {
    client.close();
  }

  return result;
}

/* ── entry point ─────────────────────────────────────────────────── */

/**
 * @param {{ force?: boolean, dryRun?: boolean, market?: string|null }} [opts]
 */
export async function runZr07Import(opts = {}) {
  const { force = false, dryRun = false, market: onlyMarket = null } = opts;
  const db = adminDb();
  const markets = onlyMarket ? MARKETS.filter((m) => m.country === String(onlyMarket).toUpperCase()) : MARKETS;

  const combined = { processedCount: 0, newCount: 0, updatedCount: 0, skippedCount: 0, quarantinedCount: 0, errors: [] };
  for (const market of markets) {
    const r = await runMarket(db, market, dryRun, force);
    combined.processedCount += r.processedCount;
    combined.newCount += r.newCount;
    combined.updatedCount += r.updatedCount;
    combined.skippedCount += r.skippedCount;
    combined.quarantinedCount += r.quarantinedCount;
    combined.errors.push(...r.errors);
  }
  return combined;
}
