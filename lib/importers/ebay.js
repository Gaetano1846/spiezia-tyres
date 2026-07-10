// Import ordini eBay (Fase 9-quinquies) — port 1:1 della Cloud Function
// `ebayOrderWebhook` (crm-3iuocs, us-central1), sorgente reale riscaricato da
// GCP. Riceve la notifica eBay Platform Notifications (XML, evento
// FixedPriceTransaction/AuctionCheckoutComplete), rifetcha l'ordine completo
// dalla eBay Fulfillment API con le nostre credenziali OAuth, scrive
// Ordini/Clienti su Firestore via Admin SDK. Il bridge esistente sincronizza
// su Postgres, nessuna modifica.
//
// Differenze dal sorgente CF originale:
//  - `Ordini.doc(id).create()` invece di `.get()`+`.set()` — chiude la
//    finestra TOCTOU (stesso pattern delle altre 4 route di questa fase).
//  - EBAY_BASIC_AUTH/EBAY_REFRESH_TOKEN letti da env var — il sorgente CF
//    originale aveva persino un refresh token hardcoded come fallback nel
//    codice, qui rimosso. Stessi nomi env già usati da lib/marketplace/sdk.js
//    e lib/emailAdmin/aiReply.js.
//  - Autenticazione: eBay Platform Notifications (formato XML legacy) non
//    supporta firma HMAC come WooCommerce — l'endpoint va registrato su eBay
//    Developer Portal con l'URL già completo di `?internal_secret=...`
//    (verifyInternalSecret lo legge da query string). L'assenza di firma sul
//    body non è un problema: il body della notifica non viene mai fidato
//    direttamente, serve solo a innescare un refetch autoritativo
//    dell'ordine dalla API eBay con le nostre credenziali — un OrderID falso
//    produce solo una chiamata eBay fallita, mai un ordine falso scritto.
//  - Modalità `dryRun`: verifica solo se l'ordine risulta nuovo (existence
//    check su Ordini), senza fetch eBay né risoluzione cliente/articoli —
//    stesso motivo delle altre route (quella risoluzione comporta chiamate
//    esterne non simulabili senza eseguirle davvero).

import { adminDb } from "../firebase-admin";
import { isAlreadyExists } from "./util";

const EBAY_FULFILLMENT_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.fulfillment";

async function getEbayAccessToken() {
  const basic = process.env.EBAY_BASIC_AUTH;
  const refresh = process.env.EBAY_REFRESH_TOKEN;
  if (!basic || !refresh) throw new Error("Missing EBAY_BASIC_AUTH / EBAY_REFRESH_TOKEN");

  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      scope: EBAY_FULFILLMENT_SCOPE,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`eBay token error ${res.status}: ${JSON.stringify(json)}`);
  return json.access_token;
}

function xmlVal(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m?.[1]?.trim() || "";
}

const PAYMENT_METHOD_MAPPING = {
  CREDIT_CARD: "CreditCard",
  PAYPAL: "PayPal",
  EBAY_GIFT_CARD: "Gift Card",
  EBAY_VOUCHER: "Voucher",
  APPLE_PAY: "Apple Pay",
  GOOGLE_PAY: "Google Pay",
};

function mapPaymentMethod(method) {
  return PAYMENT_METHOD_MAPPING[method] || method || "CreditCard";
}

async function fetchFullOrder(orderId, token) {
  const res = await fetch(`https://api.ebay.com/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Language": "en-US" },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Fulfillment API ${res.status}: ${errText}`);
  }
  return res.json();
}

async function findOrCreateCustomer(db, order) {
  const rawUsername = order.buyer?.username || "unknown";
  const customerId = `EB_${rawUsername.replace(/[^a-zA-Z0-9]/g, "_")}`;

  const customerRef = db.collection("Clienti").doc(customerId);
  const existing = await customerRef.get();
  if (existing.exists) return customerRef;

  const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;

  await customerRef.set({
    ID: customerId,
    Nome: shipTo?.fullName || rawUsername,
    Email: "",
    Telefono: shipTo?.primaryPhone?.phoneNumber || "",
    Via: shipTo?.contactAddress?.addressLine1 || "",
    Citta: shipTo?.contactAddress?.city || "",
    CAP: shipTo?.contactAddress?.postalCode || "",
    Paese: shipTo?.contactAddress?.countryCode || "",
    Codice_Fiscale: "",
    Partita_Iva: "",
    Azienda: false,
    Ragione_Sociale: "",
    Tipo: "Guest",
    B2B: false,
    Source: "eBay",
    CreatedAt: new Date(),
    eBay_Username: rawUsername,
  });

  return customerRef;
}

async function processLineItems(db, lineItems) {
  const articoli = [];

  for (const item of lineItems) {
    let prodottoRef = null;
    let prodottoData = null;

    if (item.sku) {
      const snap = await db.collection("Prodotti").where("SKU", "==", item.sku).limit(1).get();
      if (!snap.empty) {
        prodottoRef = snap.docs[0].ref;
        prodottoData = snap.docs[0].data();
      }
    }

    if (!prodottoRef && item.legacyItemId) {
      for (const field of ["ebayItemId", "ebayItemId_FR", "ebayItemId_DE", "ebayItemId_ES"]) {
        const snap = await db.collection("Prodotti").where(field, "==", item.legacyItemId).limit(1).get();
        if (!snap.empty) {
          prodottoRef = snap.docs[0].ref;
          prodottoData = snap.docs[0].data();
          break;
        }
      }
    }

    if (!prodottoRef) {
      console.warn(`[eBay-Orders] Prodotto non trovato: SKU=${item.sku}, ItemID=${item.legacyItemId}`);
    }

    const prezzo = parseFloat(item.discountedLineItemCost?.value || item.total?.value || "0");
    const quantita = item.quantity || 1;
    const pfu = Number(prodottoData?.PFU || 0);

    articoli.push({
      Ref: prodottoRef,
      Titolo: prodottoData?.Titolo || item.title || "",
      SKU: prodottoData?.SKU || item.sku || "",
      Prezzo: prezzo,
      Prezzo_Totale: parseFloat((prezzo * quantita).toFixed(2)),
      Quantita: quantita,
      PFU: pfu,
      PFU_Totale: parseFloat((pfu * quantita).toFixed(2)),
      Contributo_Logistico: 0,
      eBay_LineItemID: item.lineItemId || "",
      eBay_LegacyItemID: item.legacyItemId || "",
    });
  }

  return articoli;
}

/* ── single order processing ─────────────────────────────────────── */

// Esportata per il test di idempotenza, stesso motivo delle altre 4 route.
export async function processEbayOrder(db, orderId, dryRun) {
  const orderRef = db.collection("Ordini").doc(orderId);
  const existing = await orderRef.get();
  if (existing.exists) return { orderDocId: orderId, skipped: true };

  if (dryRun) return { orderDocId: orderId, skipped: false };

  const token = await getEbayAccessToken();
  const order = await fetchFullOrder(orderId, token);

  const clienteRef = await findOrCreateCustomer(db, order);
  const articoli = await processLineItems(db, order.lineItems || []);

  const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
  const indirizzo = {
    Destinatario: shipTo?.fullName || "",
    Via: shipTo?.contactAddress?.addressLine1 || "",
    CAP: shipTo?.contactAddress?.postalCode || "",
    Citta: shipTo?.contactAddress?.city || "",
    Paese: shipTo?.contactAddress?.countryCode || "",
    Telefono: shipTo?.primaryPhone?.phoneNumber || "",
  };

  const isItaly = indirizzo.Paese === "IT";
  const payment = order.paymentSummary?.payments?.[0];
  const metodoPagamento = mapPaymentMethod(payment?.paymentMethod || "");

  const pagamento = {
    Nome: metodoPagamento,
    ID: payment?.paymentReferenceId || "",
    Descrizione: metodoPagamento,
    Costo: 0,
    Costo_Extra: 0,
  };

  const totale = parseFloat(order.pricingSummary?.total?.value || "0");
  const iva = parseFloat(order.pricingSummary?.tax?.value || "0");
  const pfuTotale = parseFloat(articoli.reduce((s, a) => s + (a.PFU_Totale || 0), 0).toFixed(2));

  const orderDoc = {
    ID: orderId,
    eBay_OrderID: orderId,
    DataOra: new Date(order.creationDate || Date.now()),
    CreatedAt: new Date(),
    Stato: "In Lavorazione",
    Source: "eBay",
    IsItaly: isItaly,
    Cliente: clienteRef,
    Articoli: articoli,
    Spese_Extra: [],
    Totale: totale,
    IVA: iva,
    PFU: pfuTotale,
    Indirizzo_Spedizione: indirizzo,
    Indirizzo_Fatturazione: indirizzo,
    Pagamento: pagamento,
    Note: order.buyerCheckoutNotes || "",
  };

  try {
    await orderRef.create(orderDoc);
  } catch (err) {
    if (isAlreadyExists(err)) return { orderDocId: orderId, skipped: true };
    throw err;
  }

  await orderRef.collection("Cronologia").add({
    Data: new Date(),
    Descrizione: "Ordine ricevuto automaticamente da eBay.",
  });

  return { orderDocId: orderId, skipped: false };
}

/* ── entry point ──────────────────────────────────────────────────── */

/**
 * @param {{ rawXml?: string, orderId?: string, dryRun?: boolean }} opts
 */
export async function runEbayWebhookImport(opts = {}) {
  const { rawXml, orderId: providedOrderId, dryRun = false } = opts;
  const db = adminDb();

  let orderId = providedOrderId;
  let skippedReason;

  if (!orderId && rawXml) {
    const eventName = xmlVal(rawXml, "NotificationEventName");
    if (!eventName) {
      console.warn("[eBay-Orders] Body non riconosciuto:", rawXml.slice(0, 1000));
      skippedReason = "body non riconosciuto";
    } else if (eventName !== "FixedPriceTransaction" && eventName !== "AuctionCheckoutComplete") {
      console.log(`[eBay-Orders] Evento ignorato: ${eventName}`);
      skippedReason = `evento ignorato: ${eventName}`;
    } else {
      orderId = xmlVal(rawXml, "OrderID");
      if (!orderId) {
        console.warn("[eBay-Orders] OrderID non trovato:", rawXml.slice(0, 2000));
        skippedReason = "OrderID non trovato nel body";
      }
    }
  }

  if (!orderId) {
    return { processedCount: 0, newCount: 0, updatedCount: 0, skippedCount: 0, errors: [], skippedReason: skippedReason || "orderId mancante" };
  }

  const { orderDocId, skipped } = await processEbayOrder(db, orderId, dryRun);
  return {
    processedCount: 1,
    newCount: skipped ? 0 : 1,
    updatedCount: 0,
    skippedCount: skipped ? 1 : 0,
    errors: [],
    orderDocId,
  };
}
