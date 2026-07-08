// Import ordini Tyre24 "Anonimo" (ordini guest, Fase 9) — port 1:1 della
// Cloud Function `processT24Orders`/`processT24OrdersManual` (crm-3iuocs,
// europe-west1), sorgente reale riscaricato da GCP. Stessa logica: pull API
// REST Alzura → scrittura Ordini/Clienti su Firestore via Admin SDK. Il
// bridge esistente sincronizza su Postgres, nessuna modifica.
//
// Differenze dal sorgente CF originale:
//  - `Ordini.doc(id).create()` invece di `.get()`+`.set()` per la scrittura
//    finale — chiude la finestra TOCTOU dell'idempotenza. Il check `.get()`
//    iniziale resta (evita di costruire l'intero ordine per niente quando è
//    già presente), ma non è più l'unica difesa contro i duplicati.
//  - Token Alzura spostato da hardcoded nel sorgente a env var `T24_ANON_TOKEN`
//    (stesso nome già atteso da lib/marketplace/sdk.js, mai popolato finora).
//  - Modalità `dryRun`: verifica solo quali ordini risultano nuovi (via
//    l'existence-check), senza risolvere cliente/articoli/indirizzi né
//    scrivere — quella risoluzione comporta scritture non deterministiche
//    (ID cliente/indirizzo auto-generati) che non si possono simulare senza
//    eseguirle davvero.

import { adminDb } from "../firebase-admin";
import { isAlreadyExists } from "./util";

const ALZURA_URL = "https://api-b2b.alzura.com/common/latestorders?counter=0&demo=0&no_tagging=1&order_role=SELLER&tracking_number=0";
const ALZURA_COUNTRY = "de";
const SOURCE = "Anonimo";

const STATUS_MAPPING = {
  "1": "In Lavorazione",
  "2": "In Preparazione",
  "3": "Spedito",
  "5": "Out of Stock",
  "7": "Cancellato Tyr24",
  "8": "Cancellato Cliente",
};

function authToken() {
  const token = process.env.T24_ANON_TOKEN;
  if (!token) throw new Error("Missing T24_ANON_TOKEN");
  return token;
}

async function fetchOrdersFromAPI() {
  const response = await fetch(ALZURA_URL, {
    headers: {
      "X-AUTH-TOKEN": authToken(),
      Accept: "application/vnd.saitowag.api+json;version=1.2",
      country: ALZURA_COUNTRY,
    },
  });
  if (!response.ok) throw new Error(`Alzura API error: ${response.status} ${response.statusText}`);
  const data = await response.json();
  return data.data || [];
}

/* ── customer / articles / addresses / payment / documents ─────────── */

async function processCustomer(db, buyer) {
  const partitaIva = buyer.tax.sales_tax_identification_number;
  const existingCustomer = await db.collection("Clienti").where("Partita_Iva", "==", partitaIva).limit(1).get();
  if (!existingCustomer.empty) return existingCustomer.docs[0].ref;

  const customerData = {
    Nome: buyer.contact.name || "",
    Email: buyer.contact.email || "",
    Telefono: buyer.contact.phone || "",
    Via: buyer.address.street || "",
    Citta: buyer.address.city || "",
    CAP: buyer.address.zip || "",
    Paese: buyer.address.country || "",
    Codice_Fiscale: buyer.tax.tax_number || "",
    Partita_Iva: partitaIva,
    Azienda: true,
    ID: buyer.id,
    Ragione_Sociale: buyer.address.name || "",
    Tipo: buyer.status_name || "",
    B2B: false,
    Source: SOURCE,
    CreatedAt: new Date(),
  };

  return db.collection("Clienti").add(customerData);
}

async function updateProductFields(prodottoDoc, attributes) {
  const prodottoData = prodottoDoc.data();
  const updates = {};

  if (!prodottoData.EPREL) {
    const eprelAttr = attributes.find((attr) => attr.key === "EPREL Url");
    if (eprelAttr) updates.EPREL = eprelAttr.value;
  }
  if (!prodottoData.Label) {
    const labelAttr = attributes.find((attr) => attr.key === "Produktdatenblatt Url");
    if (labelAttr) updates.Label = labelAttr.value;
  }
  if (Object.keys(updates).length > 0) await prodottoDoc.ref.update(updates);
}

async function processArticles(db, positions, isItaly) {
  const articoli = [];
  for (const position of positions) {
    const supplierItemNumber = position.supplier_item_number;
    const prodottoQuery = await db.collection("Prodotti").where("SKU", "==", supplierItemNumber).limit(1).get();
    if (prodottoQuery.empty) continue;

    const prodottoDoc = prodottoQuery.docs[0];
    const prodottoData = prodottoDoc.data();
    await updateProductFields(prodottoDoc, position.attributes);

    const pfu = isItaly ? (prodottoData.PFU || 0) : 0;
    const quantity = position.quantity;
    const unitPrice = isItaly ? position.price.gross_converted : position.price.net_converted;

    articoli.push({
      Ref: prodottoDoc.ref,
      Titolo: prodottoData.Titolo || "",
      SKU: prodottoData.SKU || "",
      Contributo_Logistico: 0,
      Prezzo: unitPrice,
      Quantita: quantity,
      PFU: pfu,
      Prezzo_Totale: unitPrice * quantity,
      PFU_Totale: pfu * quantity,
    });
  }
  return articoli;
}

function processExtraExpenses(order, isItaly) {
  const speseExtra = [];
  const priceField = isItaly ? "gross_converted" : "net_converted";
  if (order.shipping.handling_fee[priceField] !== 0) {
    speseExtra.push({ Nome: "Spese Gestione", Importo: order.shipping.handling_fee[priceField] });
  }
  if (order.shipping.delivery_address.price?.[priceField] !== 0) {
    speseExtra.push({ Nome: "Spedizione Neutra", Importo: order.shipping.delivery_address.price[priceField] });
  }
  if (order.shipping.method.price[priceField] !== 0) {
    speseExtra.push({ Nome: "Spedizione", Importo: order.shipping.method.price[priceField] });
  }
  if (order.payment.method.price[priceField] !== 0) {
    speseExtra.push({ Nome: "Spese di Pagamento", Importo: order.payment.method.price[priceField] });
  }
  if (order.payment.price_additional[priceField] !== 0) {
    speseExtra.push({ Nome: "Spese di Pagamento Extra", Importo: order.payment.price_additional[priceField] });
  }
  return speseExtra;
}

async function processSubcollectionAddress(clienteRef, subcollectionName, addressData, name) {
  const addressToCheck = {
    Nome: addressData.name || name,
    Destinatario: addressData.name || name,
    Via: addressData.street || "",
    CAP: addressData.zip || "",
    Citta: addressData.city || "",
    Paese: addressData.country || "",
  };

  const existingAddress = await clienteRef.collection(subcollectionName)
    .where("Nome", "==", addressToCheck.Nome)
    .where("Via", "==", addressToCheck.Via)
    .where("CAP", "==", addressToCheck.CAP)
    .where("Citta", "==", addressToCheck.Citta)
    .where("Paese", "==", addressToCheck.Paese)
    .limit(1)
    .get();

  if (!existingAddress.empty) return existingAddress.docs[0].ref;
  return clienteRef.collection(subcollectionName).add(addressToCheck);
}

async function processAddresses(order, clienteRef) {
  const indirizzoFatturazioneRef = await processSubcollectionAddress(
    clienteRef, "Indirizzo_FatturazioneC", order.buyer.address, order.buyer.address.name
  );

  const useAlt = order.shipping.delivery_address.use_alternative_address;
  const indirizzoSpedizioneRef = await processSubcollectionAddress(
    clienteRef, "Indirizzo_SpedizioneC",
    useAlt ? order.shipping.delivery_address.address : order.buyer.address,
    useAlt ? order.shipping.delivery_address.address.name : order.buyer.address.name
  );

  const [fattDoc, spedDoc] = await Promise.all([indirizzoFatturazioneRef.get(), indirizzoSpedizioneRef.get()]);

  return {
    indirizzoFatturazione: {
      Via: fattDoc.data().Via, Citta: fattDoc.data().Citta, CAP: fattDoc.data().CAP,
      Telefono: order.buyer.contact.phone || "", Destinatario: fattDoc.data().Destinatario, Paese: fattDoc.data().Paese,
    },
    indirizzoSpedizione: {
      Via: spedDoc.data().Via, Citta: spedDoc.data().Citta, CAP: spedDoc.data().CAP,
      Telefono: order.shipping.delivery_address.contact?.phone || order.buyer.contact.phone || "",
      Destinatario: spedDoc.data().Destinatario, Paese: spedDoc.data().Paese,
    },
  };
}

function processPayment(payment, isItaly) {
  const priceField = isItaly ? "gross_converted" : "net_converted";
  return {
    Nome: payment.method.name || "",
    ID: String(payment.method.id),
    Descrizione: payment.method.text || "",
    Costo: payment.method.price[priceField] || 0,
    Costo_Extra: payment.price_additional[priceField] || 0,
  };
}

function processDocuments(documents) {
  if (!documents || !Array.isArray(documents)) return [];
  return documents.map((doc) => ({ ID: String(doc.id), Tipo: doc.type, Reference_Number: doc.reference_number, Link: doc.endpoint }));
}

async function notifyTyre24OrderReceived(orderId, country) {
  try {
    const response = await fetch(`https://api-b2b.alzura.com/seller/order/${orderId}/status`, {
      method: "PATCH",
      headers: {
        "X-AUTH-TOKEN": authToken(),
        country: country || ALZURA_COUNTRY,
        Accept: "application/vnd.saitowag.api+json;version=1.1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status_id: 1 }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.warn(`[T24 Notify] Anonimo order ${orderId} status update returned HTTP ${response.status}: ${body}`);
    }
  } catch (err) {
    console.error(`[T24 Notify] Anonimo failed to notify for order ${orderId}:`, err instanceof Error ? err.message : err);
  }
}

/* ── single order processing ─────────────────────────────────────── */

async function processOrder(db, order, dryRun) {
  const orderRef = db.collection("Ordini").doc(order.order);

  // Fast-path: se già esiste, evitiamo di risolvere cliente/articoli/indirizzi
  // per niente. La race residua (creato tra questo check e la .create() sotto)
  // è chiusa dalla .create() stessa più avanti, non da questo check.
  const existing = await orderRef.get();
  if (existing.exists) return { orderDocId: order.order, skipped: true };

  if (dryRun) return { orderDocId: order.order, skipped: false };

  const deliveryCountry = order.shipping.delivery_address.use_alternative_address
    ? order.shipping.delivery_address.address.country
    : order.buyer.address.country;
  const isItaly = deliveryCountry?.toLowerCase().includes("ital") || false;

  const clienteRef = await processCustomer(db, order.buyer);
  const articoli = await processArticles(db, order.positions, isItaly);
  const speseExtra = processExtraExpenses(order, isItaly);

  const totalePFU = isItaly ? articoli.reduce((sum, art) => sum + (art.PFU_Totale || 0), 0) : 0;
  const totaleIVA = isItaly ? (order.total_sum.gross_converted - order.total_sum.net_converted) : 0;
  const totale = isItaly ? order.total_sum.gross_converted : order.total_sum.net_converted;

  const addressData = await processAddresses(order, clienteRef);
  const pagamento = processPayment(order.payment, isItaly);
  const documenti = processDocuments(order.documents);
  const stato = STATUS_MAPPING[order.status.toString()] || "Unknown";

  const orderDoc = {
    ID: order.order,
    DataOra: new Date(order.date),
    Stato: stato,
    Articoli: articoli,
    Spese_Extra: speseExtra,
    Totale: totale,
    IVA: totaleIVA,
    PFU: totalePFU,
    Cliente: clienteRef,
    Indirizzo_Spedizione: addressData.indirizzoSpedizione,
    Indirizzo_Fatturazione: addressData.indirizzoFatturazione,
    Pagamento: pagamento,
    Documenti: documenti,
    Note: order.comment || "",
    CreatedAt: new Date(),
    Source: SOURCE,
    IsItaly: isItaly,
    T24_Country: order.country || "",
  };

  try {
    await orderRef.create(orderDoc);
  } catch (err) {
    if (isAlreadyExists(err)) return { orderDocId: order.order, skipped: true };
    throw err;
  }

  await notifyTyre24OrderReceived(order.order, order.country);
  return { orderDocId: order.order, skipped: false };
}

/* ── entry point ──────────────────────────────────────────────────── */

/**
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function runTyre24AnonimoImport(opts = {}) {
  const { dryRun = false } = opts;
  const db = adminDb();
  const result = { processedCount: 0, newCount: 0, updatedCount: 0, skippedCount: 0, errors: [] };

  const orders = await fetchOrdersFromAPI();
  for (const order of orders) {
    try {
      const { skipped } = await processOrder(db, order, dryRun);
      result.processedCount++;
      if (skipped) result.skippedCount++;
      else result.newCount++;
    } catch (err) {
      result.errors.push({ id: order.order, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
