// Accesso Postgres al dominio Clienti (Fase 3 della migrazione Firebase→PG).
// core.clienti è ora la fonte autoritativa per le scritture: il bridge le
// propaga a Firestore, così il CRM FlutterFlow legacy continua a vederle.
//
// Le funzioni restituiscono la stessa forma PascalCase di `lib/types.ts` così
// i componenti React esistenti non cambiano (solo la sorgente dati cambia).

import { getDb } from "@/lib/db";
import type { Cliente, Veicolo } from "@/lib/types";

export type ClienteApi = Omit<Cliente, "Sede"> & { SedeId?: string | null };
export type VeicoloApi = Veicolo;

function rowToCliente(r: Record<string, unknown>): ClienteApi {
  return {
    id: r.id as string,
    Nome: (r.nome as string) ?? undefined,
    Ragione_Sociale: (r.ragione_sociale as string) ?? undefined,
    Azienda: (r.azienda as boolean) ?? undefined,
    Email: (r.email as string) ?? undefined,
    Telefono: (r.telefono as string) ?? undefined,
    Via: (r.via as string) ?? undefined,
    Citta: (r.citta as string) ?? undefined,
    CAP: (r.cap as string) ?? undefined,
    Partita_Iva: (r.partita_iva as string) ?? undefined,
    Codice_Fiscale: (r.codice_fiscale as string) ?? undefined,
    PEC: (r.pec as string) ?? undefined,
    Tipo: (r.tipo as string) ?? undefined,
    B2B: (r.b2b as boolean) ?? undefined,
    Fido: (r.fido as number) ?? undefined,
    Fido_Residuo: (r.fido_residuo as number) ?? undefined,
    Paese: (r.paese as string) ?? undefined,
    Source: (r.source as string) ?? undefined,
    Locale: (r.locale as boolean) ?? undefined,
    Metodo_di_Pagamento: (r.metodo_pagamento as string) ?? undefined,
    Note: (r.note as string) ?? undefined,
    SedeId: (r.sede_id as string) ?? null,
  };
}

function rowToVeicolo(r: Record<string, unknown>): VeicoloApi {
  return {
    id: r.id as string,
    Targa: (r.targa as string) ?? "",
    Marca: (r.marca as string) ?? "",
    Modello: (r.modello as string) ?? "",
    Anno: (r.anno as number) ?? undefined,
    Km: (r.km as number) ?? undefined,
    Note: (r.note as string) ?? undefined,
  };
}

const CLIENTE_COLS = `id, nome, ragione_sociale, azienda, email, telefono, via, citta, cap,
  partita_iva, codice_fiscale, pec, tipo, b2b, fido, fido_residuo, paese, source,
  locale, metodo_pagamento, note, sede_id`;

/** Lista/ricerca clienti (sostituisce le ~6 query Firestore duplicate nei picker). */
export async function searchClienti(q: string | undefined, limit = 200): Promise<ClienteApi[]> {
  const db = getDb();
  if (!db) return [];
  if (q && q.trim()) {
    const { rows } = await db.query(
      `SELECT ${CLIENTE_COLS} FROM core.clienti
        WHERE (nome || ' ' || coalesce(ragione_sociale,'') || ' ' || coalesce(email,'') || ' ' || coalesce(telefono,''))
              ILIKE $1
        ORDER BY coalesce(ragione_sociale, nome) ASC NULLS LAST
        LIMIT $2`,
      [`%${q.trim()}%`, limit]
    );
    return rows.map(rowToCliente);
  }
  const { rows } = await db.query(
    `SELECT ${CLIENTE_COLS} FROM core.clienti ORDER BY coalesce(ragione_sociale, nome) ASC NULLS LAST LIMIT $1`,
    [limit]
  );
  return rows.map(rowToCliente);
}

export async function getCliente(id: string): Promise<ClienteApi | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query(`SELECT ${CLIENTE_COLS} FROM core.clienti WHERE id = $1`, [id]);
  return rows[0] ? rowToCliente(rows[0]) : null;
}

export async function findClienteByEmail(email: string): Promise<{ id: string } | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query(`SELECT id FROM core.clienti WHERE email = $1 LIMIT 1`, [email]);
  return rows[0] ?? null;
}

export async function sedeIdForUser(uid: string): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query(`SELECT sede_id FROM core.utenti WHERE id = $1`, [uid]);
  return rows[0]?.sede_id ?? null;
}

/** ULID compatto per nuove righe (valido come doc ID Firestore) — timestamp + random. */
function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
}

export interface CreateClienteInput {
  Nome?: string;
  Ragione_Sociale?: string;
  Email: string;
  Telefono: string;
  Via?: string;
  Citta?: string;
  CAP: string;
  Paese?: string;
  Codice_Fiscale?: string;
  Partita_Iva?: string;
  PEC?: string;
  Tipo?: string;
  Metodo_di_Pagamento?: string;
  Azienda: boolean;
  Fido?: number;
  SedeId?: string | null;
}

/** Crea un cliente. Ritorna null se l'email esiste già (chiamante decide il 409). */
export async function createCliente(input: CreateClienteInput): Promise<ClienteApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");

  const existing = await findClienteByEmail(input.Email);
  if (existing) return null;

  const id = newId();
  const fido = Number.isFinite(input.Fido) ? Number(input.Fido) : 0;
  const { rows } = await db.query(
    `INSERT INTO core.clienti
       (id, nome, ragione_sociale, azienda, email, telefono, via, citta, cap,
        paese, codice_fiscale, partita_iva, pec, tipo, metodo_pagamento,
        b2b, locale, fido, fido_residuo, sede_id, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false,true,$16,$16,$17,'b2b-crm')
     RETURNING ${CLIENTE_COLS}`,
    [id, input.Nome || null, input.Ragione_Sociale || null, input.Azienda, input.Email,
     input.Telefono, input.Via || null, input.Citta || null, input.CAP,
     input.Paese || null, input.Codice_Fiscale || null, input.Partita_Iva || null,
     input.PEC || null, input.Tipo || null, input.Metodo_di_Pagamento || null,
     fido, input.SedeId || null]
  );
  return rowToCliente(rows[0]);
}

export interface UpdateClienteInput {
  Nome?: string; Ragione_Sociale?: string; Azienda?: boolean; Email?: string; Telefono?: string;
  Via?: string; Citta?: string; CAP?: string; Codice_Fiscale?: string; Partita_Iva?: string;
  PEC?: string; Fido?: number; Fido_Residuo?: number; Note?: string;
}

export async function updateCliente(id: string, input: UpdateClienteInput): Promise<ClienteApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const { rows } = await db.query(
    `UPDATE core.clienti SET
       nome = coalesce($2, nome), ragione_sociale = coalesce($3, ragione_sociale),
       azienda = coalesce($4, azienda), email = coalesce($5, email), telefono = coalesce($6, telefono),
       via = coalesce($7, via), citta = coalesce($8, citta), cap = coalesce($9, cap),
       codice_fiscale = coalesce($10, codice_fiscale), partita_iva = coalesce($11, partita_iva),
       pec = coalesce($12, pec), fido = coalesce($13, fido), fido_residuo = coalesce($14, fido_residuo),
       note = coalesce($15, note)
     WHERE id = $1
     RETURNING ${CLIENTE_COLS}`,
    [id, input.Nome, input.Ragione_Sociale, input.Azienda, input.Email, input.Telefono,
     input.Via, input.Citta, input.CAP, input.Codice_Fiscale, input.Partita_Iva,
     input.PEC, input.Fido, input.Fido_Residuo, input.Note]
  );
  return rows[0] ? rowToCliente(rows[0]) : null;
}

// ─── Veicoli ──────────────────────────────────────────────────────────────────

export async function listVeicoli(clienteId: string): Promise<VeicoloApi[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(
    `SELECT id, targa, marca, modello, anno, km, note FROM b2b.veicoli WHERE cliente_id = $1 ORDER BY targa`,
    [clienteId]
  );
  return rows.map(rowToVeicolo);
}

export interface UpsertVeicoloInput {
  Targa: string; Marca?: string; Modello?: string; Anno?: number; Km?: number; Note?: string;
}

export async function createVeicolo(clienteId: string, input: UpsertVeicoloInput): Promise<VeicoloApi> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const id = newId();
  const { rows } = await db.query(
    `INSERT INTO b2b.veicoli (id, cliente_id, targa, marca, modello, anno, km, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, targa, marca, modello, anno, km, note`,
    [id, clienteId, input.Targa?.toUpperCase() || null, input.Marca || null,
     input.Modello || null, input.Anno ?? null, input.Km ?? null, input.Note || null]
  );
  return rowToVeicolo(rows[0]);
}

export async function updateVeicolo(id: string, input: Partial<UpsertVeicoloInput>): Promise<VeicoloApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const { rows } = await db.query(
    `UPDATE b2b.veicoli SET
       targa = coalesce($2, targa), marca = coalesce($3, marca), modello = coalesce($4, modello),
       anno = coalesce($5, anno), km = coalesce($6, km), note = coalesce($7, note)
     WHERE id = $1
     RETURNING id, targa, marca, modello, anno, km, note`,
    [id, input.Targa?.toUpperCase(), input.Marca, input.Modello, input.Anno, input.Km, input.Note]
  );
  return rows[0] ? rowToVeicolo(rows[0]) : null;
}

export async function deleteVeicolo(id: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(`DELETE FROM b2b.veicoli WHERE id = $1`, [id]);
}

export interface VeicoloConClienteApi extends VeicoloApi {
  ClienteId: string;
  ClienteNome: string;
}

/** Ricerca cross-cliente per targa (collectionGroup(Veicolo) su Firestore → indice PG). */
export async function searchVeicoloByTarga(targa: string): Promise<VeicoloConClienteApi[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(
    `SELECT v.id, v.cliente_id, v.targa, v.marca, v.modello, v.anno, v.km, v.note,
            coalesce(NULLIF(c.ragione_sociale, ''), c.nome, '—') AS cliente_nome
       FROM b2b.veicoli v
       LEFT JOIN core.clienti c ON c.id = v.cliente_id
      WHERE upper(v.targa) = upper($1) LIMIT 20`,
    [targa]
  );
  return rows.map((r) => ({
    ...rowToVeicolo(r),
    ClienteId: r.cliente_id as string,
    ClienteNome: r.cliente_nome as string,
  }));
}
