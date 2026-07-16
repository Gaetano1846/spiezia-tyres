// Accesso Postgres al dominio Promemoria CRM (era users/promemoria_crm/Promemoria
// — un "doc sentinella" Firestore condiviso, letto/scritto direttamente dal
// client sia dalla scheda cliente che dalla dashboard). b2b.promemoria esiste
// da tempo (migration 005_b2b_crm.sql) ma non era mai stato agganciato a
// nessuna route: le due pagine CRM continuavano a parlare a Firestore anche
// dopo il cutover del resto del dominio CRM (Appuntamenti/Fogli — Fase 7).
//
// Colonne native: cliente_id, utente_id, testo (titolo), data (scadenza),
// fatto. Il vecchio doc Firestore aveva anche "Descrizione" (corpo libero),
// che non ha una colonna dedicata — salvata in fs_extra, stesso pattern già
// in uso su questa tabella per i campi non normalizzati.
//
// Promemoria NON è nel bridge (né in bridge/registry.mjs né in
// WATCHED_COLLECTIONS) — verificato che nessun consumer esterno (CRM Flutter
// legacy crm-3iuocs, Prezzo-Gomme, spiezia-tyres-vetrina) legge mai
// "Promemoria"/"promemoria_crm" da Firestore: era una feature client-side
// esclusiva di questa app Next.js. Nessun trigger trg_bridge_outbox aggiunto
// di conseguenza — sarebbe infrastruttura non necessaria.

import { getDb, newId } from "@/lib/db";

export interface PromemoriaApi {
  id: string;
  ClienteId: string | null;
  ClienteNome: string;
  Nome: string;
  Descrizione: string | null;
  DataScadenza: string | null;
  Completata: boolean;
}

function nomeClienteFrom(nome: string | null, ragioneSociale: string | null, azienda: boolean | null): string {
  if (azienda && ragioneSociale) return ragioneSociale;
  return nome?.trim() || ragioneSociale || "—";
}

function rowToPromemoria(r: Record<string, unknown>): PromemoriaApi {
  const extra = (r.fs_extra as Record<string, unknown>) ?? {};
  return {
    id: r.id as string,
    ClienteId: (r.cliente_id as string) ?? null,
    ClienteNome: nomeClienteFrom(r.cliente_nome as string | null, r.cliente_ragione_sociale as string | null, r.cliente_azienda as boolean | null),
    Nome: (r.testo as string) ?? "",
    Descrizione: (extra.Descrizione as string) ?? null,
    DataScadenza: r.data ? (r.data as Date).toISOString() : null,
    Completata: (r.fatto as boolean) ?? false,
  };
}

const SELECT_BASE = `
  SELECT p.*, c.nome AS cliente_nome, c.ragione_sociale AS cliente_ragione_sociale,
         c.azienda AS cliente_azienda
    FROM b2b.promemoria p
    LEFT JOIN core.clienti c ON c.id = p.cliente_id`;

export interface ListPromemoriaOptions {
  limit?: number;
  /** Filtra per cliente (scheda cliente CRM). */
  clienteId?: string;
  /** Filtra per stato (dashboard: solo quelli ancora aperti). */
  completata?: boolean;
}

export async function listPromemoria(opts: ListPromemoriaOptions = {}): Promise<PromemoriaApi[]> {
  const db = getDb();
  if (!db) return [];
  const { limit = 50, clienteId, completata } = opts;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (clienteId) { params.push(clienteId); conditions.push(`p.cliente_id = $${params.length}`); }
  if (completata !== undefined) { params.push(completata); conditions.push(`p.fatto = $${params.length}`); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit);
  const { rows } = await db.query(
    `${SELECT_BASE} ${where} ORDER BY p.data ASC NULLS LAST LIMIT $${params.length}`,
    params
  );
  return rows.map(rowToPromemoria);
}

export interface PromemoriaInput {
  clienteId: string;
  nome: string;
  descrizione?: string | null;
  dataScadenza?: string | null; // ISO
  utenteId?: string | null;
}

export async function getPromemoria(id: string): Promise<PromemoriaApi | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query(`${SELECT_BASE} WHERE p.id = $1`, [id]);
  return rows[0] ? rowToPromemoria(rows[0]) : null;
}

export async function createPromemoria(input: PromemoriaInput): Promise<PromemoriaApi> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const id = newId();
  const fsExtra = input.descrizione ? { Descrizione: input.descrizione } : {};
  await db.query(
    `INSERT INTO b2b.promemoria (id, cliente_id, utente_id, testo, data, fatto, fs_extra)
     VALUES ($1,$2,$3,$4,$5,false,$6)`,
    [id, input.clienteId, input.utenteId ?? null, input.nome, input.dataScadenza ?? null, JSON.stringify(fsExtra)]
  );
  return (await getPromemoria(id))!;
}

/** Aggiorna solo lo stato completata — unico campo modificabile da entrambe le pagine CRM oggi. */
export async function updatePromemoriaCompletata(id: string, completata: boolean): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const { rowCount } = await db.query(
    `UPDATE b2b.promemoria SET fatto = $2 WHERE id = $1`,
    [id, completata]
  );
  return (rowCount ?? 0) > 0;
}

export async function deletePromemoria(id: string): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const { rowCount } = await db.query(`DELETE FROM b2b.promemoria WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
