// Accesso Postgres al dominio Spedizioni. Lettura lista/KPI + assegnazione
// sede magazzino da Fase 6; da Fase 4 (migrazione Spedizioni/GLS) anche
// createSpedizioniEntries/updateSpedizioniStatus, usate da lib/gls/sdk.js
// per le spedizioni GLS reali (creazione/chiusura/eliminazione) — prima
// scritte Firestore-diretto, il dominio a più alto rischio del progetto
// (tocca spedizioni fatturate da GLS). Il bridge esistente propaga verso
// Firestore per il CRM Flutter legacy.

import { getDb, newId } from "@/lib/db";

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

// ─── Scrittura spedizioni GLS (Fase 4 migrazione Spedizioni/GLS) ──────────────

export interface CreateSpedizioneInput {
  /** Numero spedizione GLS — diventa sia id che parcel_id. */
  parcelId: string;
  ordineId?: string | null;
  /** BDA (order.ID lato Firestore storico). */
  orderIdExt?: string | null;
  destinationName?: string | null;
  contractIndex?: number | null;
  corriere: string;
  dataString: string;
  status: string;
  warehouseStatus?: string | null;
  source: string;
  /** Payload grezzo del risultato GLS (pr) — colonna dedicata, mai fs_extra
   *  (bug storico nel bridge Firestore-diretto, corretto in Fase 4.0). */
  raw?: Record<string, unknown>;
}

/** Crea una riga b2b.spedizioni per ogni collo appena creato su GLS —
 *  equivalente esatto di createSpedizioniEntries (lib/gls/sdk.js, versione
 *  Firestore-diretta pre-Fase 4). */
export async function createSpedizioniEntries(entries: CreateSpedizioneInput[]): Promise<void> {
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");
  if (entries.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const e of entries) {
      await client.query(
        `INSERT INTO b2b.spedizioni
           (id, parcel_id, ordine_id, order_id_ext, destination_name, contract_index, corriere,
            data_string, status, warehouse_status, source, raw, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
         ON CONFLICT (id) DO NOTHING`,
        [
          e.parcelId, e.parcelId, e.ordineId ?? null, e.orderIdExt ?? null, e.destinationName ?? null,
          e.contractIndex ?? null, e.corriere, e.dataString, e.status, e.warehouseStatus ?? null,
          e.source, JSON.stringify(e.raw ?? {}),
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface SpedizioneStatusResult {
  parcelId: string;
  [key: string]: unknown;
}

/** Aggiorna lo stato di un lotto di spedizioni — closeInfo è l'intero
 *  risultato per-collo (stesso shape dell'originale Firestore-diretto:
 *  `closeInfo: r`, non solo il campo success). */
export async function updateSpedizioniStatus(results: SpedizioneStatusResult[], newStatus: string): Promise<void> {
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");
  if (results.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of results) {
      await client.query(
        `UPDATE b2b.spedizioni SET status = $1, close_info = $2, updated_at = now() WHERE id = $3`,
        [newStatus, JSON.stringify(r), r.parcelId]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Job bulk GLS (Fase 4.3 — SpedizioniJobs → Postgres) ──────────────────────
//
// Progress-feed del pulsante "Spedisci" bulk. Prima Firestore-only con widget
// realtime via onSnapshot; ora Postgres-autoritativo, il widget passa a
// polling breve (nessuna infra WebSocket/SSE in questo repo — vedi
// components/layout/SpedizioniJobsWidget.tsx). Il bridge esistente propaga
// comunque verso Firestore per compatibilità Flutter.

export interface SpedizioneJobApi {
  id: string;
  Tipo: string;
  Sede: string | null;
  ContractIndex: number | null;
  TotalOrders: number;
  ProcessedOrders: number;
  SuccessOrders: number;
  FailedOrders: number;
  Failures: unknown[];
  Status: string;
  Error: string | null;
  Marketplace: Record<string, unknown> | null;
  CreatedBy: string | null;
  CreatedAt: string | null;
  FinishedAt: string | null;
}

function rowToSpedizioneJob(r: Record<string, unknown>): SpedizioneJobApi {
  return {
    id: r.id as string,
    Tipo: (r.tipo as string) ?? "GLS",
    Sede: (r.sede as string) ?? null,
    ContractIndex: r.contract_index != null ? Number(r.contract_index) : null,
    TotalOrders: Number(r.total_orders ?? 0),
    ProcessedOrders: Number(r.processed_orders ?? 0),
    SuccessOrders: Number(r.success_orders ?? 0),
    FailedOrders: Number(r.failed_orders ?? 0),
    Failures: (r.failures as unknown[]) ?? [],
    Status: (r.status as string) ?? "running",
    Error: (r.error as string) ?? null,
    Marketplace: (r.marketplace as Record<string, unknown>) ?? null,
    CreatedBy: (r.created_by as string) ?? null,
    CreatedAt: r.created_at ? (r.created_at as Date).toISOString() : null,
    FinishedAt: r.finished_at ? (r.finished_at as Date).toISOString() : null,
  };
}

export async function getSpedizioneJob(id: string): Promise<SpedizioneJobApi | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query(`SELECT * FROM b2b.spedizioni_jobs WHERE id = $1`, [id]);
  if (!rows[0]) return null;
  return rowToSpedizioneJob(rows[0]);
}

export interface CreateSpedizioneJobInput {
  sede?: string | null;
  contractIndex?: number | null;
  totalOrders: number;
  createdBy?: string | null;
}

/** @returns id del job appena creato (generato qui, ULID-like). */
export async function createSpedizioneJob(input: CreateSpedizioneJobInput): Promise<string> {
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");
  const id = newId();
  await pool.query(
    `INSERT INTO b2b.spedizioni_jobs (id, tipo, sede, contract_index, total_orders, created_by, created_at)
     VALUES ($1,'GLS',$2,$3,$4,$5,now())`,
    [id, input.sede ?? null, input.contractIndex ?? null, input.totalOrders, input.createdBy ?? null]
  );
  return id;
}

export interface UpdateSpedizioneJobProgressInput {
  processedOrders: number;
  successOrders: number;
  failedOrders: number;
  failures: unknown[];
}

export async function updateSpedizioneJobProgress(id: string, input: UpdateSpedizioneJobProgressInput): Promise<void> {
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");
  await pool.query(
    `UPDATE b2b.spedizioni_jobs
        SET processed_orders = $1, success_orders = $2, failed_orders = $3, failures = $4, updated_at = now()
      WHERE id = $5`,
    [input.processedOrders, input.successOrders, input.failedOrders, JSON.stringify(input.failures), id]
  );
}

export interface FinishSpedizioneJobInput {
  status: string;
  processedOrders?: number;
  successOrders?: number;
  failedOrders?: number;
  failures?: unknown[];
  marketplace?: Record<string, unknown>;
  error?: string;
}

/** Chiude un job (status "done"/"error") — anche usata per il caso crash
 *  (status:"error", solo error+status, il resto invariato). */
export async function finishSpedizioneJob(id: string, input: FinishSpedizioneJobInput): Promise<void> {
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");
  await pool.query(
    `UPDATE b2b.spedizioni_jobs
        SET status = $1,
            processed_orders = coalesce($2, processed_orders),
            success_orders = coalesce($3, success_orders),
            failed_orders = coalesce($4, failed_orders),
            failures = coalesce($5, failures),
            marketplace = coalesce($6, marketplace),
            error = coalesce($7, error),
            finished_at = now(),
            updated_at = now()
      WHERE id = $8`,
    [
      input.status, input.processedOrders ?? null, input.successOrders ?? null, input.failedOrders ?? null,
      input.failures ? JSON.stringify(input.failures) : null,
      input.marketplace ? JSON.stringify(input.marketplace) : null,
      input.error ?? null, id,
    ]
  );
}
