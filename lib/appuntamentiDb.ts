// Accesso Postgres al dominio Appuntamenti (Fase 6 — cutover app→Postgres;
// Fase 7 — estende listAppuntamenti con filtri clienteId/from/to per il
// cutover di dashboard CRM e scheda cliente, che leggevano Appuntamenti
// direttamente da Firestore).
// b2b.appuntamenti è ora la fonte autoritativa per le scritture: il bridge le
// propaga a Firestore, così il CRM FlutterFlow legacy continua a vederle.

import { getDb, newId } from "@/lib/db";

export interface AppuntamentoApi {
  id: string;
  ClienteId: string | null;
  ClienteNome: string;
  VeicoloId: string | null;
  OperatoreId: string | null;
  SedeId: string | null;
  SedeNome: string;
  Stato: string;
  DataOra: string | null;
  Intervento: string | null;
  Servizi: Array<{ Titolo?: string; Prezzo?: number; Quantita?: number }> | null;
  Pneumatici: Array<{ Marca?: string; Misura?: string; Stagione?: string; Quantita?: number }> | null;
  Note: string | null;
}

function nomeClienteFrom(nome: string | null, ragioneSociale: string | null, azienda: boolean | null): string {
  if (azienda && ragioneSociale) return ragioneSociale;
  return nome?.trim() || ragioneSociale || "—";
}

function rowToAppuntamento(r: Record<string, unknown>): AppuntamentoApi {
  return {
    id: r.id as string,
    ClienteId: (r.cliente_id as string) ?? null,
    ClienteNome: nomeClienteFrom(r.cliente_nome as string | null, r.cliente_ragione_sociale as string | null, r.cliente_azienda as boolean | null),
    VeicoloId: (r.veicolo_id as string) ?? null,
    OperatoreId: (r.operatore_id as string) ?? null,
    SedeId: (r.sede_id as string) ?? null,
    SedeNome: (r.sede_nome as string) ?? "—",
    Stato: (r.stato as string) ?? "Programmato",
    DataOra: r.data_ora ? (r.data_ora as Date).toISOString() : null,
    Intervento: (r.intervento as string) ?? null,
    Servizi: (r.servizi as AppuntamentoApi["Servizi"]) ?? null,
    Pneumatici: (r.pneumatici as AppuntamentoApi["Pneumatici"]) ?? null,
    Note: (r.note as string) ?? null,
  };
}

const SELECT_BASE = `
  SELECT a.*, c.nome AS cliente_nome, c.ragione_sociale AS cliente_ragione_sociale,
         c.azienda AS cliente_azienda, s.nome AS sede_nome
    FROM b2b.appuntamenti a
    LEFT JOIN core.clienti c ON c.id = a.cliente_id
    LEFT JOIN core.sedi s ON s.id = a.sede_id`;

export interface ListAppuntamentiOptions {
  limit?: number;
  /** Filtra per cliente (scheda cliente CRM). */
  clienteId?: string;
  /** Range inclusivo su data_ora, ISO string — usato dalla dashboard per "oggi". */
  from?: string;
  to?: string;
}

export async function listAppuntamenti(opts: ListAppuntamentiOptions = {}): Promise<AppuntamentoApi[]> {
  const db = getDb();
  if (!db) return [];
  const { limit = 200, clienteId, from, to } = opts;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (clienteId) { params.push(clienteId); conditions.push(`a.cliente_id = $${params.length}`); }
  if (from)      { params.push(from);      conditions.push(`a.data_ora >= $${params.length}`); }
  if (to)        { params.push(to);        conditions.push(`a.data_ora <= $${params.length}`); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit);
  // Un range di date (dashboard "oggi") mostra la giornata in ordine cronologico;
  // la lista CRM/scheda-cliente resta più-recente-prima (comportamento invariato).
  const order = from || to ? "ASC" : "DESC";
  const { rows } = await db.query(
    `${SELECT_BASE} ${where} ORDER BY a.data_ora ${order} NULLS LAST LIMIT $${params.length}`,
    params
  );
  return rows.map(rowToAppuntamento);
}

export async function getAppuntamento(id: string): Promise<AppuntamentoApi | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query(`${SELECT_BASE} WHERE a.id = $1`, [id]);
  return rows[0] ? rowToAppuntamento(rows[0]) : null;
}

export interface AppuntamentoInput {
  clienteId: string;
  sedeId: string;
  veicoloId?: string | null;
  operatoreId?: string | null;
  dataOra: string; // ISO
  stato: string;
  intervento?: string | null;
  servizi?: AppuntamentoApi["Servizi"];
  pneumatici?: AppuntamentoApi["Pneumatici"];
  note?: string | null;
}

export async function createAppuntamento(input: AppuntamentoInput): Promise<AppuntamentoApi> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const id = newId();
  const { rows } = await db.query(
    `INSERT INTO b2b.appuntamenti
       (id, cliente_id, sede_id, veicolo_id, operatore_id, data_ora, stato, intervento, servizi, pneumatici, note, data_creazione)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
     RETURNING id`,
    [id, input.clienteId, input.sedeId, input.veicoloId || null, input.operatoreId || null,
     input.dataOra, input.stato, input.intervento || null,
     input.servizi ? JSON.stringify(input.servizi) : null,
     input.pneumatici ? JSON.stringify(input.pneumatici) : null,
     input.note || null]
  );
  return (await getAppuntamento(rows[0].id))!;
}

export async function updateAppuntamento(id: string, input: AppuntamentoInput): Promise<AppuntamentoApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(
    `UPDATE b2b.appuntamenti SET
       cliente_id = $2, sede_id = $3, veicolo_id = $4, operatore_id = $5,
       data_ora = $6, stato = $7, intervento = $8, servizi = $9, pneumatici = $10, note = $11
     WHERE id = $1`,
    [id, input.clienteId, input.sedeId, input.veicoloId || null, input.operatoreId || null,
     input.dataOra, input.stato, input.intervento || null,
     input.servizi ? JSON.stringify(input.servizi) : null,
     input.pneumatici ? JSON.stringify(input.pneumatici) : null,
     input.note || null]
  );
  return getAppuntamento(id);
}
