// Import ordini WooCommerce (+ eBay/Amazon via plugin WC, Fase 9, cutover
// Postgres-first in Fase 3 migrazione Ordini) — port 1:1 della Cloud Function
// `importWooOrders` (crm-3iuocs, europe-west3), sorgente reale riscaricato da
// GCP. Riceve il webhook WooCommerce (payload ordine completo) o una
// chiamata manuale `{ orderId }` (fetch via REST API WC), scrive
// direttamente su Postgres (core.ordini/ordine_articoli/clienti), stesso
// pattern di lib/importers/tyre24Anonimo.js. Il bridge esistente propaga
// automaticamente ogni riga verso Firestore per il CRM Flutter legacy.
//
// Differenze dal sorgente CF originale:
//  - Scrittura diretta su Postgres invece che Firestore (Fase 3 — la
//    finestra "doppio webhook" verso la CF GCP è chiusa, GCP disattivato,
//    unico scrittore rimasto è questo endpoint VPS).
//  - Idempotenza via PRIMARY KEY + `ON CONFLICT DO NOTHING` (core.ordini.id),
//    equivalente esatto del `.create()` Firestore usato in precedenza qui.
//  - Credenziali WooCommerce (WC_URL/WC_KEY/WC_SECRET) spostate da hardcoded
//    a env var.
//  - Modalità `dryRun`: verifica solo se l'ordine risulta nuovo, senza
//    risolvere cliente/articoli/indirizzi né scrivere.
//  - Scope NON coperto (decisione esplicita, stessa di tyre24PgWrite.js):
//    niente indirizzi salvati in rubrica cliente — solo lo snapshot
//    indirizzo sull'ordine stesso.

import { adminDb } from "../firebase-admin";
import { isAlreadyExists } from "./util";
import { resolveOrCreateClientePg, insertOrderPg, orderExistsPg, insertCronologiaPg } from "./tyre24PgWrite";

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

// @returns {Promise<string>} cliente_id (esistente o appena creato)
async function processCustomer(wcOrder) {
  const customerEmail = wcOrder.billing.email;
  const customerId = `WC_${wcOrder.customer_id || "guest"}_${customerEmail.replace(/[^a-zA-Z0-9]/g, "_")}`;

  await resolveOrCreateClientePg(customerId, {
    nome: `${wcOrder.billing.first_name} ${wcOrder.billing.last_name}`.trim(),
    email: wcOrder.billing.email || "",
    telefono: wcOrder.billing.phone || "",
    via: wcOrder.billing.address_1 || "",
    citta: wcOrder.billing.city || "",
    cap: wcOrder.billing.postcode || "",
    paese: wcOrder.billing.country || "",
    codiceFiscale: "",
    partitaIva: wcOrder.billing.company ? "Unknown" : "",
    azienda: !!wcOrder.billing.company,
    ragioneSociale: wcOrder.billing.company || "",
    tipo: wcOrder.customer_id ? "Registered" : "Guest",
    b2b: !!wcOrder.billing.company,
    source: "WooCommerce",
    fsExtra: { WC_CustomerID: wcOrder.customer_id },
  });
  return customerId;
}

// NB: risolve DELIBERATAMENTE via Firestore (non public.prodotti) — stesso
// motivo documentato in tyre24PgWrite.js::resolveArticlesPg.
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

    const fsExtra = { WC_ProductID: item.product_id, WC_ItemID: item.id };

    if (prodottoQuery.empty) {
      articoli.push({
        ref_path: null,
        titolo: item.name,
        sku: item.sku || `WC_${item.product_id}`,
        contributo_logistico: 0,
        prezzo_unitario: parseFloat(item.price),
        quantita: item.quantity,
        pfu: 0,
        tot_riga: parseFloat(item.total),
        fs_extra: fsExtra,
      });
      continue;
    }

    const prodottoDoc = prodottoQuery.docs[0];
    const prodottoData = prodottoDoc.data();
    const pfu = prodottoData.PFU || 0;
    const quantity = item.quantity;

    articoli.push({
      ref_path: prodottoDoc.ref.path,
      titolo: prodottoData.Titolo || item.name,
      sku: prodottoData.SKU || item.sku,
      contributo_logistico: 0,
      prezzo_unitario: parseFloat(item.price),
      quantita: quantity,
      pfu,
      tot_riga: parseFloat(item.total),
      fs_extra: fsExtra,
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

// Snapshot indirizzo calcolato puro — nessuna scrittura/lettura in rubrica
// (scope non coperto, vedi commento in testa al file).
function addressSnapshot(addressData, phone) {
  const fullName = `${addressData.first_name || ""} ${addressData.last_name || ""}`.trim();
  const destinatario = addressData.company || fullName;
  return {
    Via: `${addressData.address_1 || ""} ${addressData.address_2 || ""}`.trim(),
    Citta: addressData.city || "",
    CAP: addressData.postcode || "",
    Telefono: phone || "",
    Destinatario: destinatario,
    Paese: addressData.country || "",
  };
}

function processAddresses(wcOrder) {
  const indirizzoFatturazione = addressSnapshot(wcOrder.billing, wcOrder.billing.phone || "");

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

  const indirizzoSpedizione = addressSnapshot(shippingAddress, shippingAddress.phone || wcOrder.billing.phone || "");

  return { indirizzoFatturazione, indirizzoSpedizione };
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
//
// Guardia scope+timing (Fase 9, trovata da un bug reale in produzione — 3
// ordini WC878457/458/459 importati vuoti sotto l'ID sbagliato): l'hook
// custom `woocommerce_new_order` su WordPress può scattare PRIMA che
// WP-Lister for Amazon abbia finito di popolare l'ordine (numero Amazon,
// line_items, indirizzi) — a quel punto `wcOrder.number === wcOrder.id`
// ancora, quindi resolveOrderDocId() sceglie l'ID "WC{id}" invece del
// corretto "AMZ{number}", e il documento risultante è vuoto. Scope
// esplicitamente ristretto ad Amazon su richiesta dell'utente ("da
// WooCommerce importiamo solo ordini Amazon") — rigettare qui, non solo
// loggare, per non scrivere mai più un ordine fantasma sotto l'ID sbagliato.
export async function processWooOrder(db, wcOrder, dryRun) {
  if (wcOrder.created_via !== "amazon") {
    return { orderDocId: null, skipped: true, reason: "created_via non è amazon, fuori scope" };
  }
  if (!Array.isArray(wcOrder.line_items) || wcOrder.line_items.length === 0) {
    return { orderDocId: null, skipped: true, reason: "line_items vuoto — ordine non ancora popolato da WP-Lister, riprovare più tardi" };
  }

  const orderDocId = resolveOrderDocId(wcOrder);

  // Fast-path idempotenza (come tyre24Anonimo.js/adtyres.js): evita di
  // risolvere cliente/articoli per niente se l'ordine esiste già. La race
  // residua è chiusa dal PRIMARY KEY + ON CONFLICT dentro insertOrderPg.
  if (await orderExistsPg(orderDocId)) return { orderDocId, skipped: true };

  if (dryRun) return { orderDocId, skipped: false };

  const isItaly = wcOrder.billing.country === "IT";

  const clienteId = await processCustomer(wcOrder);
  const articoli = await processArticles(db, wcOrder.line_items);
  const speseExtra = processExtraExpenses(wcOrder);

  const totalePFU = isItaly ? articoli.reduce((sum, art) => sum + art.pfu * art.quantita, 0) : 0;
  const totaleIVA = parseFloat(wcOrder.total_tax) || 0;

  const { indirizzoFatturazione, indirizzoSpedizione } = processAddresses(wcOrder);
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

  const fsExtra = {
    IsItaly: isItaly,
    Spese_Extra: speseExtra,
    WC_OrderNumber: wcOrder.number,
    WC_OrderKey: wcOrder.order_key,
  };
  if (eBayOrderID) fsExtra.eBay_OrderID = eBayOrderID;
  if (amazonMarketplaceId) fsExtra.Amazon_MarketplaceID = amazonMarketplaceId;

  let result;
  try {
    result = await insertOrderPg(
      orderDocId,
      {
        source: SOURCE_MAPPING[wcOrder.created_via] || wcOrder.created_via || "WooCommerce",
        stato: WC_STATUS_MAPPING[wcOrder.status] || "In Lavorazione",
        clienteId,
        totale: parseFloat(wcOrder.total),
        iva: totaleIVA,
        pfu: totalePFU,
        pagamento,
        indirizzoFatturazione,
        indirizzoSpedizione,
        note: wcOrder.customer_note || "",
        t24Country: null,
        dataOra: new Date(wcOrder.date_created),
        createdAt: new Date(),
        fsExtra,
      },
      articoli
    );
  } catch (err) {
    if (isAlreadyExists(err)) return { orderDocId, skipped: true };
    throw err;
  }

  if (result.skipped) return { orderDocId, skipped: true };

  await insertCronologiaPg(orderDocId, "Ordine importato automaticamente da WooCommerce.");

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
