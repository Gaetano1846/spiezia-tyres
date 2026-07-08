// Accesso Postgres al dominio Spedizioni (Fase 6 — cutover app→Postgres),
// SOLO lettura lista/KPI + assegnazione sede magazzino (scrittura pura,
// nessuna Cloud Function coinvolta).
//
// Tutto il resto della pagina admin/spedizioni (chiudi manifesto GLS/SDA,
// elimina spedizioni GLS, rigenera etichette, push tracking marketplace,
// stampa etichetta) resta VOLUTAMENTE Firestore/Cloud-Function diretto: sono
// tutte operazioni che toccano il dominio Ordini/GLS/pagamenti, il più a
// rischio di tutto il progetto ed esplicitamente escluso dalla migrazione
// fin dal piano iniziale. b2b.spedizioni è scritta anche da lib/gls/sdk.js
// (Admin SDK diretto su Firestore) — il bridge la sincronizza qui senza che
// quel modulo debba cambiare (vedi commento in mapping/spedizioni.mjs).

import { getDb } from "@/lib/db";

export interface SpedizioneApi {
  id: string;
  ParcelId: string | null;
  OrdineId: string | null;
  OrderIdExt: string | null;
  DestinationName: string | null;
  Source: string | null;
  Corriere: string | null;
  ContractIndex: number | null;
  WarehouseSedeId: string | null;
  MagazzinoLabel: string;
  Status: string | null;
  WarehouseStatus: string | null;
  CreatedAt: string | null;
}

function rowToSpedizione(r: Record<string, unknown>): SpedizioneApi {
  return {
    id: r.id as string,
    ParcelId: (r.parcel_id as string) ?? null,
    OrdineId: (r.ordine_id as string) ?? null,
    OrderIdExt: (r.order_id_ext as string) ?? null,
    DestinationName: (r.destination_name as string) ?? null,
    Source: (r.source as string) ?? null,
    Corriere: (r.corriere as string) ?? null,
    ContractIndex: (r.contract_index as number) ?? null,
    WarehouseSedeId: (r.warehouse_sede_id as string) ?? null,
    MagazzinoLabel: (r.sede_nome as string) ?? "—",
    Status: (r.status as string) ?? null,
    WarehouseStatus: (r.warehouse_status as string) ?? null,
    CreatedAt: r.created_at ? (r.created_at as Date).toISOString() : null,
  };
}

export async function listSpedizioni(dataDaIso: string, dataAIso: string, limit = 2000): Promise<{ rows: SpedizioneApi[]; capped: boolean }> {
  const db = getDb();
  if (!db) return { rows: [], capped: false };
  const { rows } = await db.query(
    `SELECT s.*, sede.nome AS sede_nome
       FROM b2b.spedizioni s
       LEFT JOIN core.sedi sede ON sede.id = s.warehouse_sede_id
      WHERE s.created_at >= $1 AND s.created_at <= $2
      ORDER BY s.created_at DESC
      LIMIT $3`,
    [dataDaIso, dataAIso, limit]
  );
  return { rows: rows.map(rowToSpedizione), capped: rows.length >= limit };
}

export interface SpedizioniKpi {
  daSpedire: number;
  inTransito: number;
  anomalie: number;
}

export async function getSpedizioniKpi(): Promise<SpedizioniKpi> {
  const db = getDb();
  if (!db) return { daSpedire: 0, inTransito: 0, anomalie: 0 };
  const { rows } = await db.query(`
    SELECT
      count(*) FILTER (WHERE status = 'created' AND warehouse_status = 'In Preparazione') AS da_spedire,
      count(*) FILTER (WHERE status = 'closed') AS in_transito,
      count(*) FILTER (WHERE warehouse_status = 'Annullato') AS anomalie
    FROM b2b.spedizioni
  `);
  return {
    daSpedire: Number(rows[0]?.da_spedire ?? 0),
    inTransito: Number(rows[0]?.in_transito ?? 0),
    anomalie: Number(rows[0]?.anomalie ?? 0),
  };
}

/** Assegna la sede magazzino a un lotto di spedizioni — mirror di
 * SelezionaSedeSpedizioneWidget (FlutterFlow): imposta anche warehouseStatus. */
export async function setSpedizioniWarehouse(ids: string[], sedeId: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  if (ids.length === 0) return;
  await db.query(
    `UPDATE b2b.spedizioni SET warehouse_sede_id = $2, warehouse_status = 'In Preparazione' WHERE id = ANY($1)`,
    [ids, sedeId]
  );
}
