// Import ordini WooCommerce (+ eBay/Amazon via plugin WC, Fase 9) — port 1:1
// della Cloud Function `importWooOrders` (crm-3iuocs, europe-west3), sorgente
// reale riscaricato da GCP. Riceve il webhook WooCommerce (payload ordine
// completo) o una chiamata manuale `{ orderId }` (fetch via REST API WC),
// scrive Ordini/Clienti su Firestore via Admin SDK. Il bridge esistente
// sincronizza su Postgres, nessuna modifica.
//
// Differenze dal sorgente CF originale:
//  - `Ordini.doc(id).create()` invece di `.get()`+`.set()` — chiude la
//    finestra TOCTOU. Qui conta più che altrove: il piano di cutover per
//    questo importer è il "doppio webhook" (WooCommerce continua a chiamare
//    anche la CF GCP, e in parallelo questo endpoint VPS, finché non si è
//    verificato che scrive correttamente) — la race tra le due chiamate è
//    la modalità operativa attesa durante la finestra di verifica, non solo
//    un caso limite difensivo.
//  - Credenziali WooCommerce (WC_URL/WC_KEY/WC_SECRET) spostate da hardcoded
//    a env var.
//  - Modalità `dryRun`: verifica solo se l'ordine risulta nuovo, senza
//    risolvere cliente/articoli/indirizzi né scrivere (stessa logica delle
//    altre 3 route di questa fase) — usata solo per il trigger manuale
//    `{ orderId }`, non dal webhook reale (il piano di verifica per Woo è il
//    doppio-webhook con traffico reale, non lo shadow-mode).

import { adminDb } from "../firebase-admin";
import { isAlreadyExists } from "./util";

const WC_URL = process.env.WC_URL || "https://wp.prezzo-gomme.it";

function wcAuth() {
  const key = process.env.WC_KEY;
  const secret = process.env.WC_SECRET;
  if (!key || !secret) throw new Error("Missing WC_KEY/WC_SECRET");
  return Buffer.from(`${key}:${secret}`).toString("base64");
}

async function wooCommerceGet(endpoint, retries = 2) {
  const url = `${WC_URL}/wp-json/wc/v3/${endpoint}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Basic ${wcAuth()}`, Accept: "application/json" },
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`WooCommerce API error ${response.status}: ${text}`);
      }
      return await response.json();
    } catch (err) {
      const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
      if (isTimeout && attempt < retries) continue;
      throw err;
    }
  }
}

const AMAZON_MARKETPLACE_MAPPING = {
  "New Amazon Account IT": "A1PA6795UKMFR9",
  "New Amazon Account FR": "A13V1IB3VIYZZH",
  "New Amazon Account ES": "A1RKKUPIHCS9HS",
  "New Amazon Account DE": "A1PA6795UKMFR9",
};

const WC_STATUS_MAPPING = {
  pending: "In Sospeso",
  processing: "In Lavorazione",
  "on-hold": "In Lavorazione",
  completed: "Completato",
  cancelled: "Cancellato Cliente",
  refunded: "Rimborsato",
  failed: "Cancellato Cliente",
};

const SOURCE_MAPPING = {
  checkout: "WooCommerce",
  ebay: "eBay",
  amazon: "Amazon",
  "rest-api": "API",
  admin: "Admin",
  import: "Import",
};

function resolveOrderDocId(wcOrder) {
  if (wcOrder.created_via === "amazon" && wcOrder.number !== wcOrder.id.toString()) {
    return `AMZ${wcOrder.number}`;
  }
  if (wcOrder.created_via === "ebay") {
    const ebaySalesRecordMeta = wcOrder.meta_data?.find((meta) => meta.key === "_ebay_sales_record_id");
    if (ebaySalesRecordMeta && ebaySalesRecordMeta.value) return `EB${ebaySalesRecordMeta.value}`;
    return `EB${wcOrder.id}`;
  }
  return `WC${wcOrder.id}`;
}

async function processCustomer(db, wcOrder) {
  const customerEmail = wcOrder.billing.email;
  const customerId = `WC_${wcOrder.customer_id || "guest"}_${customerEmail.replace(/[^a-zA-Z0-9]/g, "_")}`;

  const existingCustomer = await db.collection("Clienti").doc(customerId).get();
  if (existingCustomer.exists) return existingCustomer.ref;

  const customerData = {
    Nome: `${wcOrder.billing.first_name} ${wcOrder.billing.last_name}`.trim(),
    Email: wcOrder.billing.email || "",
    Telefono: wcOrder.billing.phone || "",
    Via: wcOrder.billing.address_1 || "",
    Citta: wcOrder.billing.city || "",
    CAP: wcOrder.billing.postcode || "",
    Paese: wcOrder.billing.country || "",
    Codice_Fiscale: "",
    Partita_Iva: wcOrder.billing.company ? "Unknown" : "",
    Azienda: !!wcOrder.billing.company,
    ID: customerId,
    Ragione_Sociale: wcOrder.billing.company || "",
    Tipo: wcOrder.customer_id ? "Registered" : "Guest",
    B2B: !!wcOrder.billing.company,
    Source: "WooCommerce",
    CreatedAt: new Date(),
    WC_CustomerID: wcOrder.customer_id,
  };

  const customerRef = db.collection("Clienti").doc(customerId);
  await customerRef.set(customerData);
  return customerRef;
}

async function processArticles(db, lineItems) {
  const articoli = [];

  for (const item of lineItems) {
    let prodottoQuery = null;

    if (item.sku) {
      prodottoQuery = await db.collection("Prodotti").where("SKU", "==", item.sku).limit(1).get();
    }
    if (!prodottoQuery || prodottoQuery.empty) {
      prodottoQuery = await db.collection("Prodotti").where("WC_ProductID", "==", item.product_id).limit(1).get();
    }

    if (prodottoQuery.empty) {
      articoli.push({
        Ref: null,
        Titolo: item.name,
        SKU: item.sku || `WC_${item.product_id}`,
        Contributo_Logistico: 0,
        Prezzo: parseFloat(item.price),
        Quantita: item.quantity,
        PFU: 0,
        Prezzo_Totale: parseFloat(item.total),
        PFU_Totale: 0,
        WC_ProductID: item.product_id,
        WC_ItemID: item.id,
      });
      continue;
    }

    const prodottoDoc = prodottoQuery.docs[0];
    const prodottoData = prodottoDoc.data();
    const pfu = prodottoData.PFU || 0;
    const quantity = item.quantity;

    articoli.push({
      Ref: prodottoDoc.ref,
      Titolo: prodottoData.Titolo || item.name,
      SKU: prodottoData.SKU || item.sku,
      Contributo_Logistico: 0,
      Prezzo: parseFloat(item.price),
      Quantita: quantity,
      PFU: pfu,
      Prezzo_Totale: parseFloat(item.total),
      PFU_Totale: pfu * quantity,
      WC_ProductID: item.product_id,
      WC_ItemID: item.id,
    });
  }

  return articoli;
}

function processExtraExpenses(wcOrder) {
  const speseExtra = [];

  if (wcOrder.shipping_lines && wcOrder.shipping_lines.length > 0) {
    wcOrder.shipping_lines.forEach((shipping) => {
      if (parseFloat(shipping.total) > 0) {
        speseExtra.push({ Nome: shipping.method_title || "Spedizione", Importo: parseFloat(shipping.total) });
      }
    });
  }

  if (wcOrder.fee_lines && wcOrder.fee_lines.length > 0) {
    wcOrder.fee_lines.forEach((fee) => {
      if (parseFloat(fee.total) > 0) {
        speseExtra.push({ Nome: fee.name || "Spese Extra", Importo: parseFloat(fee.total) });
      }
    });
  }

  return speseExtra;
}

async function processSubcollectionAddress(clienteRef, subcollectionName, addressData, type) {
  const fullName = `${addressData.first_name || ""} ${addressData.last_name || ""}`.trim();
  const destinatario = addressData.company || fullName;

  const addressToCheck = {
    Nome: `${type} - ${destinatario}`,
    Destinatario: destinatario,
    Via: addressData.address_1 || "",
    CAP: addressData.postcode || "",
    Citta: addressData.city || "",
    Paese: addressData.country || "",
  };

  const existingAddress = await clienteRef.collection(subcollectionName)
    .where("Destinatario", "==", addressToCheck.Destinatario)
    .where("Via", "==", addressToCheck.Via)
    .where("CAP", "==", addressToCheck.CAP)
    .where("Citta", "==", addressToCheck.Citta)
    .where("Paese", "==", addressToCheck.Paese)
    .limit(1)
    .get();

  if (!existingAddress.empty) return existingAddress.docs[0].ref;
  return clienteRef.collection(subcollectionName).add(addressToCheck);
}

async function processAddresses(wcOrder, clienteRef) {
  const indirizzoFatturazioneRef = await processSubcollectionAddress(clienteRef, "Indirizzo_FatturazioneC", wcOrder.billing, "Fatturazione");

  let shippingAddress = wcOrder.shipping;
  if (
    !shippingAddress ||
    !shippingAddress.address_1 ||
    !shippingAddress.city ||
    !shippingAddress.country ||
    shippingAddress.address_1.trim() === "" ||
    shippingAddress.city.trim() === ""
  ) {
    shippingAddress = wcOrder.billing;
  }

  const indirizzoSpedizioneRef = await processSubcollectionAddress(clienteRef, "Indirizzo_SpedizioneC", shippingAddress, "Spedizione");

  const [fattDoc, spedDoc] = await Promise.all([indirizzoFatturazioneRef.get(), indirizzoSpedizioneRef.get()]);

  return {
    indirizzoFatturazione: {
      Via: `${fattDoc.data().Via} ${wcOrder.billing.address_2 || ""}`.trim(),
      Citta: fattDoc.data().Citta,
      CAP: fattDoc.data().CAP,
      Telefono: wcOrder.billing.phone || "",
      Destinatario: fattDoc.data().Destinatario,
      Paese: fattDoc.data().Paese,
    },
    indirizzoSpedizione: {
      Via: `${spedDoc.data().Via} ${shippingAddress.address_2 || ""}`.trim(),
      Citta: spedDoc.data().Citta,
      CAP: spedDoc.data().CAP,
      Telefono: shippingAddress.phone || wcOrder.billing.phone || "",
      Destinatario: spedDoc.data().Destinatario,
      Paese: spedDoc.data().Paese,
    },
  };
}

function processPayment(wcOrder) {
  let transactionFee = 0;

  if (wcOrder.payment_method === "ppcp-gateway") {
    const paypalFeeData = wcOrder.meta_data?.find((meta) => meta.key === "PayPal Transaction Fee");
    if (paypalFeeData && paypalFeeData.value) transactionFee = parseFloat(paypalFeeData.value) || 0;
  } else if (wcOrder.payment_method === "woocommerce_payments") {
    const wcpayFeeData = wcOrder.meta_data?.find((meta) => meta.key === "_wcpay_transaction_fee");
    if (wcpayFeeData && wcpayFeeData.value) transactionFee = parseFloat(wcpayFeeData.value) || 0;
  }

  return {
    Nome: wcOrder.payment_method_title || wcOrder.payment_method || "",
    ID: wcOrder.transaction_id || "",
    Descrizione: wcOrder.payment_method_title || "",
    Costo: transactionFee,
    Costo_Extra: 0,
  };
}

/* ── single order processing ─────────────────────────────────────── */

// Esportata per il test di idempotenza, stesso motivo delle altre 3 route.
export async function processWooOrder(db, wcOrder, dryRun) {
  const orderDocId = resolveOrderDocId(wcOrder);
  const orderRef = db.collection("Ordini").doc(orderDocId);

  const existing = await orderRef.get();
  if (existing.exists) return { orderDocId, skipped: true };

  if (dryRun) return { orderDocId, skipped: false };

  const isItaly = wcOrder.billing.country === "IT";

  const clienteRef = await processCustomer(db, wcOrder);
  const articoli = await processArticles(db, wcOrder.line_items);
  const speseExtra = processExtraExpenses(wcOrder);

  const totalePFU = isItaly ? articoli.reduce((sum, art) => sum + (art.PFU_Totale || 0), 0) : 0;
  const totaleIVA = parseFloat(wcOrder.total_tax) || 0;

  const addressData = await processAddresses(wcOrder, clienteRef);
  const pagamento = processPayment(wcOrder);

  let eBayOrderID = null;
  if (wcOrder.created_via === "ebay") {
    const eBayOrderMeta = wcOrder.meta_data?.find((meta) => meta.key === "_ebay_order_id");
    if (eBayOrderMeta && eBayOrderMeta.value) eBayOrderID = eBayOrderMeta.value;
  }

  let amazonMarketplaceId = null;
  if (wcOrder.created_via === "amazon") {
    const amazonAccountMeta = wcOrder.meta_data?.find((meta) => meta.key === "_wpla_amazon_account");
    if (amazonAccountMeta && amazonAccountMeta.value) amazonMarketplaceId = AMAZON_MARKETPLACE_MAPPING[amazonAccountMeta.value] || null;
  }

  const orderDoc = {
    ID: orderDocId,
    DataOra: new Date(wcOrder.date_created),
    Stato: WC_STATUS_MAPPING[wcOrder.status] || "In Lavorazione",
    Articoli: articoli,
    Spese_Extra: speseExtra,
    Totale: parseFloat(wcOrder.total),
    IVA: totaleIVA,
    PFU: totalePFU,
    Cliente: clienteRef,
    Indirizzo_Spedizione: addressData.indirizzoSpedizione,
    Indirizzo_Fatturazione: addressData.indirizzoFatturazione,
    Pagamento: pagamento,
    Note: wcOrder.customer_note || "",
    CreatedAt: new Date(),
    Source: SOURCE_MAPPING[wcOrder.created_via] || wcOrder.created_via || "WooCommerce",
    IsItaly: isItaly,
    WC_OrderNumber: wcOrder.number,
    WC_OrderKey: wcOrder.order_key,
  };

  if (eBayOrderID) orderDoc.eBay_OrderID = eBayOrderID;
  if (amazonMarketplaceId) orderDoc.Amazon_MarketplaceID = amazonMarketplaceId;

  try {
    await orderRef.create(orderDoc);
  } catch (err) {
    if (isAlreadyExists(err)) return { orderDocId, skipped: true };
    throw err;
  }

  await orderRef.collection("Cronologia").add({
    Data: new Date(),
    Descrizione: "Ordine importato automaticamente da WooCommerce.",
  });

  return { orderDocId, skipped: false };
}

/* ── entry point ──────────────────────────────────────────────────── */

/**
 * @param {{ wcOrder?: object, orderId?: string|number, dryRun?: boolean }} opts
 */
export async function runWooImport(opts = {}) {
  const { wcOrder: providedOrder, orderId, dryRun = false } = opts;
  const db = adminDb();

  const wcOrder = providedOrder || (await wooCommerceGet(`orders/${orderId}`));

  const { orderDocId, skipped } = await processWooOrder(db, wcOrder, dryRun);
  return {
    processedCount: 1,
    newCount: skipped ? 0 : 1,
    updatedCount: 0,
    skippedCount: skipped ? 1 : 0,
    errors: [],
    orderDocId,
  };
}
