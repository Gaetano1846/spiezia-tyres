// Marketplace tracking SDK — port interno delle integrazioni della vecchia
// Cloud Function `ExternalApiIntegrations` (crm-3iuocs), sezione "Aggiorna Tracking"
// + messaggio eBay "Out of Stock" (Fase 9-quater, custom action out_of_stock.dart).
//
// Porting 1:1 degli handler originali (firebase/functions/api_manager.js). Uniche
// differenze: axios → fetch, e le credenziali (prima hardcoded nella CF) ora sono
// lette da process.env (vedi .env.local):
//   • eBay   : EBAY_BASIC_AUTH, EBAY_REFRESH_TOKEN
//   • Amazon : AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET, AMAZON_REFRESH_TOKEN
//   • Tyre24 : T24_TOKEN (Tyre24), T24_ANON_TOKEN (Anonimo)
//   • AdTyres : ADTYRES_TRACKING_FTP_HOST/USER/PASSWORD (era CF pubblica, ora
//     port diretto: carica il CSV di tracking via FTP, vedi sendADTyresTracking)
//
// Dispatch per Source dell'ordine, identico al widget FlutterFlow
// spedizioni_admin (Tyre24/Anonimo → Alzura, eBay, Amazon, AdTyres). SDA
// (Reshark) è stato dismesso — non più supportato come corriere.

import { Client as FtpClient } from "basic-ftp";
import { Readable } from "node:stream";
import { adminDb } from "../firebase-admin";

const ALZURA_ACCEPT = "application/vnd.saitowag.api+json;version=1.1";

// Timeout coerente con la vecchia CF (nessun timeout esplicito lato axios, ma
// evitiamo di restare appesi indefinitamente sulle API esterne).
const TIMEOUT_MS = 30000;

async function httpRequest(url, { method = "GET", headers = {}, body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    let parsed = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON: teniamo il testo */ }
    return { ok: res.ok, status: res.status, body: parsed, rawText: text };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Tyre24 / Alzura ─────────────────────────────────────────────────────────
// PATCH .../seller/order/{id}/status  { status_id, comment }
async function tyreStatusUpdate({ orderID, statusIndex, comment, country, token }) {
  return httpRequest(`https://api-b2b.alzura.com/seller/order/${orderID}/status`, {
    method: "PATCH",
    headers: { "X-AUTH-TOKEN": token, country, Accept: ALZURA_ACCEPT, "Content-Type": "application/json" },
    body: JSON.stringify({ status_id: statusIndex, comment }),
  });
}

// PATCH .../seller/order/{id}/tracking  { parcel_numbers: [...], shipping_company_id }
async function tyreTrackingUpdate({ orderID, parcelNumbers, country, shipping, token }) {
  return httpRequest(`https://api-b2b.alzura.com/seller/order/${orderID}/tracking`, {
    method: "PATCH",
    headers: { "X-AUTH-TOKEN": token, country, Accept: ALZURA_ACCEPT, "Content-Type": "application/json" },
    body: JSON.stringify({ parcel_numbers: parcelNumbers, shipping_company_id: shipping }),
  });
}

// ─── eBay ────────────────────────────────────────────────────────────────────
async function ebayGetToken() {
  const basic = process.env.EBAY_BASIC_AUTH;
  const refresh = process.env.EBAY_REFRESH_TOKEN;
  if (!basic || !refresh) throw new Error("Missing EBAY_BASIC_AUTH / EBAY_REFRESH_TOKEN");
  const res = await httpRequest("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      scope: "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    }),
  });
  if (!res.ok || !res.body?.access_token) {
    throw new Error(`eBay token error ${res.status}: ${res.rawText?.slice(0, 200)}`);
  }
  return res.body.access_token;
}

async function ebayGetLineItemIds(token, ebayOrderId) {
  const res = await httpRequest(`https://api.ebay.com/sell/fulfillment/v1/order/${ebayOrderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`eBay getOrder error ${res.status}: ${res.rawText?.slice(0, 200)}`);
  const lineItems = res.body?.lineItems;
  if (!Array.isArray(lineItems) || lineItems.length === 0) throw new Error("eBay: nessun lineItem nell'ordine");
  const ids = lineItems.map((li) => li.lineItemId).filter(Boolean);
  if (ids.length === 0) throw new Error("eBay: nessun lineItemId valido");
  return ids;
}

async function ebayUpdateTracking(token, ebayOrderId, tracking, lineItemId, courier) {
  return httpRequest(`https://api.ebay.com/sell/fulfillment/v1/order/${ebayOrderId}/shipping_fulfillment`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      shippingCarrierCode: courier,
      trackingNumber: tracking,
      lineItems: [{ lineItemId }],
    }),
  });
}

// Replica della custom action eBayAddTracking: token → lineItems → tracking per item
async function ebayAddTracking({ ebayOrderId, tracking, courier }) {
  const token = await ebayGetToken();
  const lineItemIds = await ebayGetLineItemIds(token, ebayOrderId);
  const results = [];
  for (const lineItemId of lineItemIds) {
    const r = await ebayUpdateTracking(token, ebayOrderId, tracking, lineItemId, courier);
    results.push({ lineItemId, ok: r.ok, status: r.status });
  }
  const okAll = results.every((r) => r.ok);
  return { ok: okAll, results };
}

// Stessa GET di ebayGetLineItemIds ma estrae i campi usati dal messaggio di
// cortesia (buyer + legacyItemId), non il lineItemId per il tracking.
async function ebayGetBuyerAndItem(token, ebayOrderId) {
  const res = await httpRequest(`https://api.ebay.com/sell/fulfillment/v1/order/${ebayOrderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`eBay getOrder error ${res.status}: ${res.rawText?.slice(0, 200)}`);
  const recipientId = res.body?.buyer?.username;
  const legacyItemId = res.body?.lineItems?.[0]?.legacyItemId;
  if (!recipientId || !legacyItemId) throw new Error("eBay: buyer o legacyItemId mancante nell'ordine");
  return { recipientId, legacyItemId };
}

// Replica della custom action out_of_stock.dart: token → buyer/legacyItemId →
// messaggio "articolo esaurito, procederemo al rimborso" via Trading API legacy
// (AddMemberMessageAAQToPartner). orderId è l'ID doc Firestore, usato anche nel
// testo del messaggio esattamente come nell'originale (comportamento replicato
// 1:1, non corretto).
function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function ebayOutOfStockMessage({ orderId, ebayOrderId }) {
  const token = await ebayGetToken();
  const { recipientId, legacyItemId } = await ebayGetBuyerAndItem(token, ebayOrderId);

  const subject = `Aggiornamento Ordine eBay: ${orderId} - Articolo Non Disponibile`;
  const messageBody =
    `Gentile cliente,\n\nti scriviamo in riferimento al tuo ordine ${orderId}.\n\n` +
    `Purtroppo, a causa di un errore di sistema, l'articolo (ID: ${legacyItemId}) risulta attualmente non disponibile a magazzino.\n\n` +
    `Ci scusiamo per l'inconveniente. Procederemo con l'annullamento dell'ordine e il rimborso totale dell'importo versato.\n\n` +
    `Restiamo a tua disposizione per qualsiasi chiarimento.\n\nCordiali saluti,\nSpiezia Tyres`;

  const requestXml =
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<AddMemberMessageAAQToPartnerRequest xmlns="urn:ebay:apis:eBLBaseComponents">\n` +
    `  <ItemID>${escapeXml(legacyItemId)}</ItemID>\n` +
    `  <MemberMessage>\n` +
    `    <Subject>${escapeXml(subject)}</Subject>\n` +
    `    <Body>${escapeXml(messageBody)}</Body>\n` +
    `    <QuestionType>CustomizedSubject</QuestionType>\n` +
    `    <RecipientID>${escapeXml(recipientId)}</RecipientID>\n` +
    `  </MemberMessage>\n` +
    `</AddMemberMessageAAQToPartnerRequest>\n`;

  const res = await httpRequest("https://api.ebay.com/ws/api.dll", {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": "AddMemberMessageAAQToPartner",
      "X-EBAY-API-SITEID": "101",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1231",
      "X-EBAY-API-IAF-TOKEN": token,
      "Content-Type": "text/xml",
    },
    body: requestXml,
  });

  const ok = res.ok && typeof res.rawText === "string" && res.rawText.includes("<Ack>Success</Ack>");
  return { ok, status: res.status, detail: ok ? "Messaggio Out of Stock inviato al buyer eBay" : `eBay AddMemberMessage ${res.status}: ${res.rawText?.slice(0, 300)}` };
}

// ─── Amazon SP-API ───────────────────────────────────────────────────────────
async function amazonGetToken() {
  const refresh = process.env.AMAZON_REFRESH_TOKEN;
  const clientId = process.env.AMAZON_CLIENT_ID;
  const clientSecret = process.env.AMAZON_CLIENT_SECRET;
  if (!refresh || !clientId || !clientSecret) {
    throw new Error("Missing AMAZON_REFRESH_TOKEN / AMAZON_CLIENT_ID / AMAZON_CLIENT_SECRET");
  }
  const res = await httpRequest("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok || !res.body?.access_token) {
    throw new Error(`Amazon token error ${res.status}: ${res.rawText?.slice(0, 200)}`);
  }
  return res.body.access_token;
}

async function amazonGetOrderItems(accessToken, amazonOrderId) {
  const res = await httpRequest(
    `https://sellingpartnerapi-eu.amazon.com/orders/v0/orders/${amazonOrderId}/orderItems`,
    { headers: { "x-amz-access-token": accessToken } }
  );
  if (!res.ok) throw new Error(`Amazon getOrderItems error ${res.status}: ${res.rawText?.slice(0, 200)}`);
  const items = res.body?.payload?.OrderItems;
  if (!Array.isArray(items) || items.length === 0) throw new Error("Amazon: nessun OrderItem");
  // Come nel FF: usa il primo item (getJsonField [:] restituisce il primo valore)
  return { itemId: items[0].OrderItemId, quantity: items[0].QuantityOrdered };
}

async function amazonUpdateTracking({ accessToken, marketplaceId, orderId, trackingNumber, itemId, quantity, shippingTime, courier }) {
  return httpRequest(
    `https://sellingpartnerapi-eu.amazon.com/orders/v0/orders/${orderId}/shipmentConfirmation`,
    {
      method: "POST",
      headers: { "x-amz-access-token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        marketplaceId,
        packageDetail: {
          packageReferenceId: "1",
          carrierCode: courier,
          trackingNumber,
          shipDate: shippingTime,
          orderItems: [{ orderItemId: itemId, quantity }],
        },
      }),
    }
  );
}

// Replica del ramo Amazon: token → orderItems → shipmentConfirmation
async function amazonAddTracking({ marketplaceId, wcOrderNumber, trackingNumber, courier }) {
  const accessToken = await amazonGetToken();
  const { itemId, quantity } = await amazonGetOrderItems(accessToken, wcOrderNumber);
  const r = await amazonUpdateTracking({
    accessToken,
    marketplaceId,
    orderId: wcOrderNumber,
    trackingNumber,
    itemId,
    quantity,
    shippingTime: new Date().toISOString(), // returnCurrentTimeISO8601()
    courier,
  });
  return { ok: r.ok, status: r.status, body: r.body };
}

// ─── AdTyres — port 1:1 della Cloud Function `sendADTyresTracking` (era CF
// pubblica su GCP, sorgente reale riscaricata). Carica un CSV via FTP nella
// dropbox tracking del partner (ftp.direct-pneus.fr), non un'API REST.
async function adTyresTracking({ orderDocId, tracking }) {
  const firestore = adminDb();
  const docSnap = await firestore.collection("Ordini").doc(orderDocId).get();
  if (!docSnap.exists) throw new Error(`Order document not found: ${orderDocId}`);

  const adtOrderNumber = docSnap.data()?.ADT_OrderNumber;
  if (!adtOrderNumber) throw new Error("Order document missing field: ADT_OrderNumber");

  const trackingUrl = `https://www.17track.net/en/track?nums=${tracking}`;
  const csvContent =
    "OrderNumber,Tracking,ShippingAgent,URL\r\n" +
    `${adtOrderNumber},${tracking},GLS,${trackingUrl}\r\n`;
  const fileName = `${adtOrderNumber}.csv`;

  const host = process.env.ADTYRES_TRACKING_FTP_HOST;
  const user = process.env.ADTYRES_TRACKING_FTP_USER;
  const password = process.env.ADTYRES_TRACKING_FTP_PASSWORD;
  if (!host || !user || !password) throw new Error("Missing ADTYRES_TRACKING_FTP_HOST/USER/PASSWORD");

  const ftp = new FtpClient();
  ftp.ftp.verbose = false;
  try {
    await ftp.access({ host, user, password, secure: false });
    await ftp.ensureDir("/tracking");
    await ftp.uploadFrom(Readable.from([csvContent]), fileName);
  } finally {
    ftp.close();
  }

  return { ok: true, status: 200, body: { success: true, file: fileName, orderNumber: adtOrderNumber, tracking } };
}

// ─── Dispatch tracking per singolo ordine (per Source) ───────────────────────
// Ritorna { source, skipped?, ok, detail }.
async function pushOrderTracking({ ordineId, corriere }) {
  const firestore = adminDb();
  const snap = await firestore.collection("Ordini").doc(ordineId).get();
  if (!snap.exists) throw new Error(`Ordine ${ordineId} non trovato`);
  const o = snap.data() || {};

  const source = o.Source || o.source || "";
  const glsTracking = o.GLS_TrackingNumber || "";
  const courierCode = corriere === "SDA" ? "SDA" : "GLS";

  if (source === "Tyre24" || source === "Anonimo") {
    const country = o.T24_Country || "";
    const token = source === "Tyre24" ? process.env.T24_TOKEN : process.env.T24_ANON_TOKEN;
    if (!token) throw new Error(`Missing ${source === "Tyre24" ? "T24_TOKEN" : "T24_ANON_TOKEN"}`);
    // shipping_company_id: SDA=23, IT=26, estero=63 (identico al widget FF)
    const shipping = corriere === "SDA" ? 23 : country === "it" ? 26 : 63;

    const st = await tyreStatusUpdate({
      orderID: ordineId,
      statusIndex: 3,
      comment: "Your order has been successfully processed and dispatched.",
      country,
      token,
    });
    if (!st.ok) return { source, ok: false, detail: `Tyre24 status ${st.status}: ${st.rawText?.slice(0, 160)}` };

    const tr = await tyreTrackingUpdate({
      orderID: ordineId,
      parcelNumbers: [glsTracking],
      country,
      shipping,
      token,
    });
    return { source, ok: tr.ok, detail: tr.ok ? "Tracking comunicato a Tyre24" : `Tyre24 tracking ${tr.status}: ${tr.rawText?.slice(0, 160)}` };
  }

  if (source === "eBay") {
    const ebayOrderId = o.eBay_OrderID || "";
    if (!ebayOrderId) throw new Error("eBay_OrderID mancante sull'ordine");
    const r = await ebayAddTracking({ ebayOrderId, tracking: glsTracking, courier: courierCode });
    return { source, ok: r.ok, detail: r.ok ? "Tracking aggiornato su eBay" : `eBay: alcuni lineItem falliti (${JSON.stringify(r.results)})` };
  }

  if (source === "Amazon") {
    const marketplaceId = o.Amazon_MarketplaceID || "";
    const wcOrderNumber = o.WC_OrderNumber || "";
    if (!wcOrderNumber) throw new Error("WC_OrderNumber mancante sull'ordine");
    const r = await amazonAddTracking({ marketplaceId, wcOrderNumber, trackingNumber: glsTracking, courier: courierCode });
    return { source, ok: r.ok, detail: r.ok ? "Tracking aggiornato su Amazon" : `Amazon shipmentConfirmation ${r.status}` };
  }

  if (source === "AdTyres") {
    const r = await adTyresTracking({ orderDocId: ordineId, tracking: glsTracking });
    return { source, ok: r.ok, detail: r.ok ? "Tracking aggiornato su AdTyres" : `AdTyres ${r.status}` };
  }

  // B2B / WooCommerce / Prezzo-Gomme / altro: nessun marketplace da aggiornare
  return { source: source || "(sconosciuto)", skipped: true, ok: true, detail: "Nessun marketplace per questa fonte" };
}

// ─── Aggiornamento stato ordine su marketplace (Tyre24/Anonimo) ──────────────
// Mirror del componente FF stato_ordine: al cambio stato invia un TyreStatusUpdate
// con lo status_id corrispondente. Solo Tyre24/Anonimo (Alzura); le altre fonti
// non hanno un endpoint di stato → skipped.
//   • In Preparazione → statusIndex 2
//   • Spedito         → statusIndex 3 (gestito da pushTracking)
//   • Out of Stock    → statusIndex 5
async function updateOrderStatus({ ordineId, statusIndex, comment }) {
  const firestore = adminDb();
  const snap = await firestore.collection("Ordini").doc(ordineId).get();
  if (!snap.exists) throw new Error(`Ordine ${ordineId} non trovato`);
  const o = snap.data() || {};
  const source = o.Source || o.source || "";
  if (source !== "Tyre24" && source !== "Anonimo") {
    return { source: source || "(sconosciuto)", skipped: true, ok: true, detail: "Nessun marketplace di stato per questa fonte" };
  }
  const country = o.T24_Country || "";
  const token = source === "Tyre24" ? process.env.T24_TOKEN : process.env.T24_ANON_TOKEN;
  if (!token) throw new Error(`Missing ${source === "Tyre24" ? "T24_TOKEN" : "T24_ANON_TOKEN"}`);
  const st = await tyreStatusUpdate({ orderID: ordineId, statusIndex, comment, country, token });
  return {
    source,
    ok: st.ok,
    detail: st.ok ? `Stato comunicato a ${source}` : `${source} status ${st.status}: ${st.rawText?.slice(0, 160)}`,
  };
}

// ─── Out of Stock (eBay) ──────────────────────────────────────────────────────
// Mirror della custom action out_of_stock.dart, chiamata quando lo stato di un
// ordine eBay viene impostato su "Out of Stock". Solo invio messaggio buyer —
// l'aggiornamento di Ordini.stato resta a carico del chiamante (route/pagina),
// stesso schema di updateOrderStatus/pushOrderTracking sopra.
async function orderOutOfStock({ ordineId }) {
  const firestore = adminDb();
  const snap = await firestore.collection("Ordini").doc(ordineId).get();
  if (!snap.exists) throw new Error(`Ordine ${ordineId} non trovato`);
  const o = snap.data() || {};
  const source = o.Source || o.source || "";
  if (source !== "eBay") {
    return { source: source || "(sconosciuto)", skipped: true, ok: true, detail: "Messaggio Out of Stock disponibile solo per ordini eBay" };
  }
  const ebayOrderId = o.eBay_OrderID || "";
  if (!ebayOrderId) throw new Error("eBay_OrderID mancante sull'ordine");
  const r = await ebayOutOfStockMessage({ orderId: ordineId, ebayOrderId });
  return { source, ok: r.ok, detail: r.detail };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point — dispatcher azioni (mirror di processGlsAction).
// Ritorna { statusCode, payload }.
// ─────────────────────────────────────────────────────────────────────────────
export async function processMarketplaceAction(body) {
  const { action, ...params } = body || {};
  if (!action) return { statusCode: 400, payload: { error: "Action is required" } };

  try {
    switch (action) {
      case "pushTracking": {
        if (!params.ordineId) return { statusCode: 400, payload: { error: "ordineId richiesto" } };
        const result = await pushOrderTracking({ ordineId: params.ordineId, corriere: params.corriere });
        return { statusCode: 200, payload: { success: true, data: result } };
      }
      case "updateStatus": {
        if (!params.ordineId) return { statusCode: 400, payload: { error: "ordineId richiesto" } };
        if (typeof params.statusIndex !== "number") return { statusCode: 400, payload: { error: "statusIndex richiesto" } };
        const result = await updateOrderStatus({ ordineId: params.ordineId, statusIndex: params.statusIndex, comment: params.comment || "" });
        return { statusCode: 200, payload: { success: true, data: result } };
      }
      case "outOfStock": {
        if (!params.ordineId) return { statusCode: 400, payload: { error: "ordineId richiesto" } };
        const result = await orderOutOfStock({ ordineId: params.ordineId });
        return { statusCode: 200, payload: { success: true, data: result } };
      }
      default:
        return { statusCode: 400, payload: { error: `Unknown action: ${action}` } };
    }
  } catch (error) {
    console.error("Marketplace API Error:", error);
    return { statusCode: 500, payload: { success: false, error: error.message } };
  }
}
