// Logica condivisa tra gli importer Tyre24 "Anonimo" (tyre24Anonimo.js) e
// "Regular" (tyre24Regular.js) — port 1:1 delle Cloud Function
// `processT24Orders`/`processT24OrdersManual` e `processOrdersScheduled`/
// `processOrdersManual` (crm-3iuocs). La parte cliente/articoli/indirizzi
// (processCustomer/processArticles/processAddresses, tutte Firestore-dirette)
// è stata rimossa qui: sostituita da tyre24PgWrite.js (Postgres-first) in
// entrambi gli importer — 0 chiamanti confermati prima della rimozione.
// Restano solo le funzioni pure/DB-agnostiche ancora in uso.

export const STATUS_MAPPING = {
  "1": "In Lavorazione",
  "2": "In Preparazione",
  "3": "Spedito",
  "5": "Out of Stock",
  "7": "Cancellato Tyr24",
  "8": "Cancellato Cliente",
};

export function processExtraExpenses(order, isItaly) {
  const speseExtra = [];
  const priceField = isItaly ? "gross_converted" : "net_converted";
  // Ogni voce è opzionale nel payload Alzura (es. delivery_address.price esiste
  // solo per spedizioni con indirizzo alternativo) — accesso con optional
  // chaining sia nel controllo sia nel valore letto, altrimenti un ordine privo
  // di una di queste sotto-strutture manda in crash l'intero import (bug reale
  // trovato il 2026-07-09 su 4 ordini reali: il controllo usava `?.` ma la
  // lettura del valore no, quindi `undefined !== 0` passava il guard e poi
  // l'accesso diretto lanciava).
  const addIfNonZero = (nome, value) => {
    if (value !== undefined && value !== 0) speseExtra.push({ Nome: nome, Importo: value });
  };
  addIfNonZero("Spese Gestione", order.shipping.handling_fee?.[priceField]);
  addIfNonZero("Spedizione Neutra", order.shipping.delivery_address.price?.[priceField]);
  addIfNonZero("Spedizione", order.shipping.method.price?.[priceField]);
  addIfNonZero("Spese di Pagamento", order.payment.method.price?.[priceField]);
  addIfNonZero("Spese di Pagamento Extra", order.payment.price_additional?.[priceField]);
  return speseExtra;
}

export function processPayment(payment, isItaly) {
  const priceField = isItaly ? "gross_converted" : "net_converted";
  return {
    Nome: payment.method.name || "",
    ID: String(payment.method.id),
    Descrizione: payment.method.text || "",
    Costo: payment.method.price[priceField] || 0,
    Costo_Extra: payment.price_additional[priceField] || 0,
  };
}

export function processDocuments(documents) {
  if (!documents || !Array.isArray(documents)) return [];
  return documents.map((doc) => ({ ID: String(doc.id), Tipo: doc.type, Reference_Number: doc.reference_number, Link: doc.endpoint }));
}

export async function notifyTyre24OrderReceived(orderId, country, token, fallbackCountry) {
  try {
    const response = await fetch(`https://api-b2b.alzura.com/seller/order/${orderId}/status`, {
      method: "PATCH",
      headers: {
        "X-AUTH-TOKEN": token,
        country: country || fallbackCountry || "",
        Accept: "application/vnd.saitowag.api+json;version=1.1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status_id: 1 }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.warn(`[T24 Notify] Order ${orderId} status update returned HTTP ${response.status}: ${body}`);
    }
  } catch (err) {
    console.error(`[T24 Notify] Failed to notify for order ${orderId}:`, err instanceof Error ? err.message : err);
  }
}
