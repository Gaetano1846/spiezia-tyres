// Scrittura diretta su Postgres per gli importer Tyre24 (Fase 9, cutover
// Postgres-first) — core.ordini/ordine_articoli/clienti invece di Firestore.
// Il bridge esistente (spiezia-bridge, live dalla Fase 4) propaga
// automaticamente ogni riga scritta qui verso Firestore via il trigger
// AFTER-row su bridge.outbox — nessuna modifica al bridge stesso necessaria
// oltre al fix del field-naming Indirizzo_Spedizione/Fatturazione già
// applicato in Spiezia-DB/mapping/ordini.mjs.
//
// Idempotenza: PRIMARY KEY su core.ordini.id (= external order id, stesso ID
// che sarebbe stato il doc Firestore) + INSERT ... ON CONFLICT DO NOTHING,
// equivalente a .create() su Firestore.
//
// Scope NON coperto (decisione esplicita, non un oversight): niente
// core.clienti_indirizzi (rubrica indirizzi cliente riusabile/deduplicata) —
// scriviamo solo lo snapshot indirizzo sull'ordine stesso (indirizzo_spedizione/
// fatturazione JSONB su core.ordini), che è il campo che conta per il
// documento Firestore ricostruito. Niente backfill EPREL/Label su
// public.prodotti (arricchimento metadati prodotto, non critico per
// l'importazione ordine).

import { getDb, newId } from "../db";

/** @returns {Promise<string>} cliente_id (esistente o appena creato) */
export async function resolveCustomerPg(client, buyer, source) {
  const partitaIva = buyer.tax.sales_tax_identification_number;
  const existing = await client.query(`SELECT id FROM core.clienti WHERE partita_iva = $1 LIMIT 1`, [partitaIva]);
  if (existing.rows.length > 0) return existing.rows[0].id;

  const id = newId();
  await client.query(
    `INSERT INTO core.clienti (id, nome, ragione_sociale, azienda, email, telefono, via, citta, cap, paese, partita_iva, codice_fiscale, tipo, b2b, source, fs_extra)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      id,
      buyer.contact.name || "",
      buyer.address.name || "",
      true,
      buyer.contact.email || "",
      buyer.contact.phone || "",
      buyer.address.street || "",
      buyer.address.city || "",
      buyer.address.zip || "",
      buyer.address.country || "",
      partitaIva,
      buyer.tax.tax_number || "",
      buyer.status_name || "",
      false,
      source,
      JSON.stringify({ ID: buyer.id }),
    ]
  );
  return id;
}

// NB: risolve DELIBERATAMENTE via Firestore (non public.prodotti) — verificato
// che public.prodotti.id NON è il doc ID Firestore originale (è SKU-based,
// public.prodotti è un catalogo Prezzo-Gomme separato con un proprio schema
// di ID, non una migrazione diretta della collection Prodotti di B2B Spiezia
// — confermato: id="09040023276" per SKU 09040023276, ma il vero doc
// Firestore per quello SKU è "5pw5u03HljiX74p3Sdg2"). Un ref_path costruito
// da public.prodotti.id punterebbe a un documento Firestore inesistente.
// Qui serve il doc ID reale per popolare correttamente Articoli[].Ref quando
// il bridge ricostruisce l'ordine su Firestore per il CRM Flutter legacy.
export async function resolveArticlesPg(fsDb, positions, isItaly) {
  const articoli = [];
  for (const position of positions) {
    const sku = position.supplier_item_number;
    const prodottoQuery = await fsDb.collection("Prodotti").where("SKU", "==", sku).limit(1).get();
    if (prodottoQuery.empty) continue;

    const prodottoDoc = prodottoQuery.docs[0];
    const prodottoData = prodottoDoc.data();
    const pfu = isItaly ? Number(prodottoData.PFU || 0) : 0;
    const quantity = position.quantity;
    const unitPrice = isItaly ? position.price.gross_converted : position.price.net_converted;

    articoli.push({
      ref_path: prodottoDoc.ref.path,
      titolo: prodottoData.Titolo || "",
      sku: prodottoData.SKU || "",
      contributo_logistico: 0,
      prezzo_unitario: unitPrice,
      quantita: quantity,
      pfu,
      tot_riga: unitPrice * quantity,
    });
  }
  return articoli;
}

function addressSnapshot(source, phone) {
  return {
    Via: source.street || "",
    Citta: source.city || "",
    CAP: source.zip || "",
    Telefono: phone || "",
    Destinatario: source.name || "",
    Paese: source.country || "",
  };
}

/** Snapshot indirizzi (stesso shape della versione Firestore-diretta), calcolati puri — nessuna query DB. */
export function buildAddressSnapshots(order) {
  const indirizzoFatturazione = addressSnapshot(order.buyer.address, order.buyer.contact.phone);

  const useAlt = order.shipping.delivery_address.use_alternative_address;
  const shippingSource = useAlt ? order.shipping.delivery_address.address : order.buyer.address;
  const shippingPhone = useAlt
    ? order.shipping.delivery_address.contact?.phone || order.buyer.contact.phone
    : order.buyer.contact.phone;
  const indirizzoSpedizione = addressSnapshot(shippingSource, shippingPhone);

  return { indirizzoFatturazione, indirizzoSpedizione };
}

/**
 * Inserisce l'ordine + articoli in una singola transazione. Ritorna
 * { skipped: true } se l'ordine esiste già (idempotenza via PRIMARY KEY).
 */
export async function insertOrderPg(orderId, orderRecord, articoli) {
  const pool = getDb();
  if (!pool) throw new Error("DATABASE_URL non configurata");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const inserted = await client.query(
      `INSERT INTO core.ordini (
         id, source, external_order_id, stato, cliente_id, totale, iva, pfu,
         pagamento, indirizzo_fatturazione, indirizzo_spedizione, note,
         t24_country, data_ora, created_at, fs_extra
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [
        orderId,
        orderRecord.source,
        orderId,
        orderRecord.stato,
        orderRecord.clienteId,
        orderRecord.totale,
        orderRecord.iva,
        orderRecord.pfu,
        JSON.stringify(orderRecord.pagamento),
        JSON.stringify(orderRecord.indirizzoFatturazione),
        JSON.stringify(orderRecord.indirizzoSpedizione),
        orderRecord.note,
        orderRecord.t24Country,
        orderRecord.dataOra,
        orderRecord.createdAt,
        JSON.stringify(orderRecord.fsExtra ?? {}),
      ]
    );

    if (inserted.rows.length === 0) {
      await client.query("ROLLBACK");
      return { skipped: true };
    }

    for (let riga = 0; riga < articoli.length; riga++) {
      const a = articoli[riga];
      await client.query(
        `INSERT INTO core.ordine_articoli (ordine_id, riga, sku, ref_path, titolo, quantita, prezzo_unitario, pfu, contributo_logistico, tot_riga, fs_extra)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [orderId, riga, a.sku, a.ref_path, a.titolo, a.quantita, a.prezzo_unitario, a.pfu, a.contributo_logistico, a.tot_riga, JSON.stringify(a.fs_extra ?? {})]
      );
    }

    await client.query("COMMIT");
    return { skipped: false };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function orderExistsPg(orderId) {
  const pool = getDb();
  if (!pool) throw new Error("DATABASE_URL non configurata");
  const { rows } = await pool.query(`SELECT 1 FROM core.ordini WHERE id = $1`, [orderId]);
  return rows.length > 0;
}

/**
 * Crea (se non esiste) un cliente con ID deterministico — a differenza di
 * resolveCustomerPg (dedup via partita_iva, per Tyre24 dove il cliente non
 * ha un ID a priori), gli importer marketplace (AdTyres/WooCommerce/eBay)
 * calcolano già un ID deterministico lato Firestore (es. "ADT_{ustid}",
 * "WC_{customerId}_{email}", "EB_{username}") — qui basta lo stesso
 * ON CONFLICT DO NOTHING del resto del modulo, senza SELECT preliminare (né
 * finestra TOCTOU: l'ID è noto a priori, non generato da questa chiamata).
 * @returns {Promise<string>} lo stesso id passato in input, per comodità di chaining.
 */
export async function resolveOrCreateClientePg(id, fields) {
  const pool = getDb();
  if (!pool) throw new Error("DATABASE_URL non configurata");
  await pool.query(
    `INSERT INTO core.clienti (id, nome, ragione_sociale, azienda, email, telefono, via, citta, cap, paese, partita_iva, codice_fiscale, tipo, b2b, source, fs_extra)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      fields.nome || "",
      fields.ragioneSociale || "",
      !!fields.azienda,
      fields.email || "",
      fields.telefono || "",
      fields.via || "",
      fields.citta || "",
      fields.cap || "",
      fields.paese || "",
      fields.partitaIva || "",
      fields.codiceFiscale || "",
      fields.tipo || "",
      !!fields.b2b,
      fields.source,
      JSON.stringify(fields.fsExtra ?? {}),
    ]
  );
  return id;
}

/**
 * Riga di cronologia per un ordine appena importato (es. "Ordine importato
 * automaticamente da AdTyres.") — stesso testo/intento del sub-doc
 * Firestore Ordini/{id}/Cronologia scritto dalle versioni Firestore-dirette
 * di questi importer. Il bridge esistente la propaga verso Firestore.
 */
export async function insertCronologiaPg(ordineId, note) {
  const pool = getDb();
  if (!pool) throw new Error("DATABASE_URL non configurata");
  await pool.query(
    `INSERT INTO b2b.ordini_cronologia (id, ordine_id, data, note) VALUES ($1,$2,now(),$3)`,
    [newId(), ordineId, note]
  );
}
