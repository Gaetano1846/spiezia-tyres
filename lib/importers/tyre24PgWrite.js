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

export async function resolveArticlesPg(client, positions, isItaly) {
  const articoli = [];
  for (const position of positions) {
    const sku = position.supplier_item_number;
    const { rows } = await client.query(`SELECT id, sku, titolo, pfu FROM public.prodotti WHERE sku = $1 LIMIT 1`, [sku]);
    if (rows.length === 0) continue;

    const prodotto = rows[0];
    const pfu = isItaly ? Number(prodotto.pfu || 0) : 0;
    const quantity = position.quantity;
    const unitPrice = isItaly ? position.price.gross_converted : position.price.net_converted;

    articoli.push({
      ref_path: `Prodotti/${prodotto.id}`,
      titolo: prodotto.titolo || "",
      sku: prodotto.sku || "",
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
        `INSERT INTO core.ordine_articoli (ordine_id, riga, sku, ref_path, titolo, quantita, prezzo_unitario, pfu, contributo_logistico, tot_riga)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [orderId, riga, a.sku, a.ref_path, a.titolo, a.quantita, a.prezzo_unitario, a.pfu, a.contributo_logistico, a.tot_riga]
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
