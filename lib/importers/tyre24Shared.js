// Logica condivisa tra gli importer Tyre24 "Anonimo" (tyre24Anonimo.js) e
// "Regular" (tyre24Regular.js) — port 1:1 delle Cloud Function
// `processT24Orders`/`processT24OrdersManual` e `processOrdersScheduled`/
// `processOrdersManual` (crm-3iuocs), che condividono byte-per-byte la stessa
// logica di processCustomer/processArticles/processAddresses/ecc, differendo
// solo per fonte dati (API diretta vs FTP) e token Alzura.

export const STATUS_MAPPING = {
  "1": "In Lavorazione",
  "2": "In Preparazione",
  "3": "Spedito",
  "5": "Out of Stock",
  "7": "Cancellato Tyr24",
  "8": "Cancellato Cliente",
};

export async function processCustomer(db, buyer, source) {
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
    Source: source,
    CreatedAt: new Date(),
  };

  return db.collection("Clienti").add(customerData);
}

export async function updateProductFields(prodottoDoc, attributes) {
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

export async function processArticles(db, positions, isItaly) {
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

export async function processSubcollectionAddress(clienteRef, subcollectionName, addressData, name) {
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

export async function processAddresses(order, clienteRef) {
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
