// Accesso Postgres al dominio Marca_Prodotto (loghi brand) —
// decommissioning finale Firebase. b2b.marche è già bidirezionale nel
// bridge (trigger outbox attivo dalla Fase 5b) — nessuna modifica lato
// Spiezia-DB necessaria, solo questo layer applicativo.

import { getDb, newId } from "@/lib/db";

export interface MarcaApi {
  id: string;
  Nome: string;
  Logo: string | null;
  Conteggio: number;
}

interface MarcaRow {
  id: string;
  nome: string | null;
  logo: string | null;
  conteggio: number | null;
}

function rowToMarca(r: MarcaRow): MarcaApi {
  return {
    id: r.id,
    Nome: r.nome ?? "",
    Logo: r.logo,
    Conteggio: r.conteggio ?? 0,
  };
}

const SELECT_COLS = `id, nome, logo, conteggio`;

export interface ListMarcheFilters {
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listMarche(filters: ListMarcheFilters = {}): Promise<MarcaApi[]> {
  const db = getDb();
  if (!db) return [];
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`nome ILIKE $${params.length}`);
  }
  const limit = Math.min(filters.limit ?? 100, 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  params.push(limit, offset);
  const { rows } = await db.query<MarcaRow>(
    `SELECT ${SELECT_COLS} FROM b2b.marche
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY nome NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows.map(rowToMarca);
}

export async function getMarca(id: string): Promise<MarcaApi | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query<MarcaRow>(`SELECT ${SELECT_COLS} FROM b2b.marche WHERE id = $1`, [id]);
  return rows[0] ? rowToMarca(rows[0]) : null;
}

export async function createMarca(input: { nome: string; logo?: string | null }): Promise<MarcaApi> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const id = newId();
  const { rows } = await db.query<MarcaRow>(
    `INSERT INTO b2b.marche (id, nome, logo, conteggio) VALUES ($1,$2,$3,0) RETURNING ${SELECT_COLS}`,
    [id, input.nome, input.logo ?? null]
  );
  return rowToMarca(rows[0]);
}

/** `logo` tri-state esplicito (null = rimuovi, stringa = imposta), risolto dal chiamante — stesso pattern di updateModello. */
export async function updateMarca(id: string, input: { nome: string; logo: string | null }): Promise<MarcaApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const { rows } = await db.query<MarcaRow>(
    `UPDATE b2b.marche SET nome = $2, logo = $3 WHERE id = $1 RETURNING ${SELECT_COLS}`,
    [id, input.nome, input.logo]
  );
  return rows[0] ? rowToMarca(rows[0]) : null;
}

export async function deleteMarca(id: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(`DELETE FROM b2b.marche WHERE id = $1`, [id]);
}
