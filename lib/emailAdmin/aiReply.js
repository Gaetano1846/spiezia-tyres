// AI reply suggestion (Fase 9-quater C) — port 1:1 della Cloud Function
// `generate_ai_reply` (crm-3iuocs, us-central1), sorgente reale riscaricato
// da GCP. Stessa logica: euristiche regex per identificare l'ordine
// collegato a un'email (Tyre24/eBay/generico), lookup su Firestore `Ordini`
// per più varianti di campo ID, fallback via eBay Fulfillment API se non
// trovato; poi chiamata OpenAI (gpt-4o-mini) con un system prompt
// strutturato che restituisce JSON, scrive `Risposta_suggerita` + metadati
// su `Emails/{id}`.
//
// Differenze dal sorgente CF originale:
//  - OPENAI_API_KEY letta da process.env (prima Secret Manager via
//    defineSecret) — stesso pattern di tutti gli altri secret in questa app.
//  - Credenziali eBay lette da EBAY_BASIC_AUTH/EBAY_REFRESH_TOKEN (env),
//    non hardcoded nel sorgente come nell'originale.
//  - Lookup Ordini resta su Firestore (non Postgres) — stesso pattern già
//    usato da lib/marketplace/sdk.js per le operazioni ordine, il bridge
//    tiene i due allineati.

import { adminDb } from "../firebase-admin";
import { FieldPath } from "firebase-admin/firestore";

async function getEbayAccessToken() {
  const basic = process.env.EBAY_BASIC_AUTH;
  const refresh = process.env.EBAY_REFRESH_TOKEN;
  if (!basic || !refresh) return null;
  try {
    const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refresh,
        scope: "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
      }),
    });
    const json = await res.json();
    if (res.status !== 200 || !json.access_token) return null;
    return json.access_token;
  } catch {
    return null;
  }
}

async function getEbaySalesRecordNumber(orderNumber, accessToken) {
  try {
    const res = await fetch(`https://api.ebay.com/sell/fulfillment/v1/order/${orderNumber}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
    const json = await res.json();
    if (res.status !== 200) return null;
    return json.salesRecordReference || null;
  } catch {
    return null;
  }
}

async function identifyOrderContext(db, subject, body, html, from) {
  const sourceText = `${subject || ""}\n${body || ""}\n${html || ""}`;
  let candidates = [];

  for (const m of sourceText.matchAll(/PTY\s*([0-9]{6,})/gi)) {
    candidates.push({ id: m[1], type: "Tyre24" });
    candidates.push({ id: `PTY${m[1]}`, type: "Tyre24" });
  }
  for (const m of sourceText.matchAll(/([0-9]{2}-[0-9]{5}-[0-9]{5})/g)) {
    candidates.push({ id: m[1], type: "eBay" });
  }
  for (const m of sourceText.matchAll(/(?:ordine|order|numero|bestellung|ref|n[°º])[:\s]*([0-9]{10,14})/gi)) {
    if (!candidates.find((c) => c.id === m[1])) candidates.push({ id: m[1], type: "Generic" });
  }

  const seenIds = new Set();
  candidates = candidates.filter((c) => (seenIds.has(c.id) ? false : (seenIds.add(c.id), true))).slice(0, 10);

  let ordineDoc = null;
  let detectedVendor = "Unknown";
  let finalOrderId = null;

  for (const cand of candidates) {
    if (ordineDoc) break;
    let q = await db.collection("Ordini").where(FieldPath.documentId(), "==", cand.id).limit(1).get();
    if (!q.empty) { ordineDoc = q.docs[0]; finalOrderId = cand.id; detectedVendor = cand.type; break; }

    q = await db.collection("Ordini").where("ID", "==", cand.id).limit(1).get();
    if (!q.empty) { ordineDoc = q.docs[0]; finalOrderId = cand.id; detectedVendor = cand.type; break; }

    q = await db.collection("Ordini").where("orderId", "==", cand.id).limit(1).get();
    if (!q.empty) { ordineDoc = q.docs[0]; finalOrderId = cand.id; detectedVendor = cand.type; break; }

    q = await db.collection("Ordini").where("eBay_OrderID", "==", cand.id).limit(1).get();
    if (!q.empty) { ordineDoc = q.docs[0]; finalOrderId = cand.id; detectedVendor = "eBay"; break; }

    q = await db.collection("Ordini").where("WC_OrderNumber", "==", cand.id).limit(1).get();
    if (!q.empty) { ordineDoc = q.docs[0]; finalOrderId = cand.id; detectedVendor = "Tyre24"; break; }
  }

  if (!ordineDoc) {
    const ebayCand = candidates.find((c) => c.type === "eBay" || (c.type === "Generic" && c.id.length === 12));
    if (ebayCand) {
      const token = await getEbayAccessToken();
      if (token) {
        let idToTest = ebayCand.id;
        if (idToTest.length === 12 && !idToTest.includes("-")) {
          idToTest = `${idToTest.slice(0, 2)}-${idToTest.slice(2, 7)}-${idToTest.slice(7, 12)}`;
        }
        const salesRecord = await getEbaySalesRecordNumber(idToTest, token);
        if (salesRecord) {
          const q = await db.collection("Ordini").where("eBay_OrderID", "==", salesRecord).limit(1).get();
          if (!q.empty) { ordineDoc = q.docs[0]; finalOrderId = idToTest; detectedVendor = "eBay"; }
        }
      }
    }
  }

  if (detectedVendor === "Unknown" || detectedVendor === "Generic") {
    if (/ebay/i.test(from) || /members\.ebay/i.test(from)) detectedVendor = "eBay";
    else if (/tyre24/i.test(from) || /tyre24/i.test(sourceText)) detectedVendor = "Tyre24";
  }

  let spedizioneDoc = null;
  if (ordineDoc) {
    try {
      const ref = db.collection("Ordini").doc(ordineDoc.id);
      const s = await db.collection("Spedizioni").where("orderReference", "==", ref).orderBy("createdAt", "desc").limit(1).get();
      if (!s.empty) spedizioneDoc = s.docs[0];
      else {
        const s2 = await db.collection("Spedizioni").where("orderReference", "==", ref).limit(1).get();
        if (!s2.empty) spedizioneDoc = s2.docs[0];
      }
    } catch { /* ignore */ }
  }

  return {
    vendor: detectedVendor,
    orderNumber: finalOrderId || (candidates.length > 0 ? candidates[0].id : null),
    ordineDoc,
    spedizioneDoc,
    orderMatch: {
      vendor: detectedVendor,
      orderId: finalOrderId || (candidates.length > 0 ? candidates[0].id : null),
      ordineRefPath: ordineDoc ? `Ordini/${ordineDoc.id}` : null,
      spedizioneRefPath: spedizioneDoc ? `Spedizioni/${spedizioneDoc.id}` : null,
    },
  };
}

/**
 * @param {string} emailId
 */
export async function generateAiReply(emailId) {
  const db = adminDb();
  const emailDoc = await db.collection("Emails").doc(emailId).get();
  if (!emailDoc.exists) throw new Error("Email non trovata");

  const emailData = emailDoc.data();
  const context = await identifyOrderContext(db, emailData.subject, emailData.body, emailData.html, emailData.from);

  if (context.orderMatch) await db.collection("Emails").doc(emailId).update({ orderMatch: context.orderMatch });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY mancante");

  const ship = context.spedizioneDoc ? context.spedizioneDoc.data() || {} : {};
  const ord = context.ordineDoc ? context.ordineDoc.data() || {} : {};

  const fullSystemPrompt =
    "Sei un assistente per Spiezia Tyres che analizza le email in arrivo.\n" +
    'RISPONDI SEMPRE in formato JSON valido: {"needsReply": boolean, "reason": string, "reply": string | null}\n' +
    "Usa i dati ordine/spedizione per rispondere a domande su tracking e stato.\n\n" +
    "REGOLE:\n- Se il cliente chiede perché è stato rimborsato/annullato, rispondi scusandoti e spiegando che l'articolo non è disponibile.\n- Rispondi sempre in italiano, sintetico e professionale.";

  const userPrompt =
    `Sorgente: ${context.vendor}.\n` +
    `Numero ordine: ${context.orderNumber || "non trovato"}.\n` +
    `Dati ordine: ${JSON.stringify(ord)}.\n` +
    `Dati spedizione: ${JSON.stringify(ship)}.\n` +
    `Mittente: ${emailData.from}.\n` +
    `Oggetto: ${emailData.subject}.\n` +
    `Testo email: ${(emailData.body || "").slice(0, 2000)}.`;

  const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: fullSystemPrompt }, { role: "user", content: userPrompt }],
      temperature: 0.2,
    }),
  });

  const json = await aiRes.json();
  const rawContent = json?.choices?.[0]?.message?.content || "";
  let aiResult;
  try {
    const cleaned = rawContent.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    aiResult = JSON.parse(cleaned);
  } catch {
    aiResult = { needsReply: true, reason: "Risposta diretta", reply: rawContent };
  }

  const updateData = {
    processedAi: true,
    aiNeedsReply: aiResult.needsReply,
    aiReason: aiResult.reason,
    aiProcessedAt: new Date(),
    aiModel: "gpt-4o-mini",
    orderMatch: context.orderMatch,
  };
  if (aiResult.needsReply) updateData.Risposta_suggerita = aiResult.reply;
  else {
    updateData.Risposta_suggerita = null;
    updateData.aiSkipReason = aiResult.reason;
  }

  await db.collection("Emails").doc(emailId).set(updateData, { merge: true });
  return updateData;
}
