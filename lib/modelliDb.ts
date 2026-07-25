// Accesso Postgres al dominio Modello (disegni/pattern pneumatico) —
// decommissioning finale Firebase. b2b.modelli è già bidirezionale nel
// bridge (trigger outbox attivo dalla Fase 5b) — nessuna modifica lato
// Spiezia-DB necessaria, solo questo layer applicativo.

import { getDb, newId } from "@/lib/db";

export interface ModelloApi {
  id: string;
  Nome: string;
  Immagine: string | null;
  Conteggio: number;
  Sinonimo: string[];
}

interface ModelloRow {
  id: string;
  nome: string | null;
  immagine: string | null;
  conteggio: number | null;
  sinonimo: string[] | null;
}

function rowToModello(r: ModelloRow): ModelloApi {
  return {
    id: r.id,
    Nome: r.nome ?? "",
    Immagine: r.immagine,
    Conteggio: r.conteggio ?? 0,
    Sinonimo: r.sinonimo ?? [],
  };
}

const SELECT_COLS = `id, nome, immagine, conteggio, sinonimo`;

export interface ListModelliFilters {
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listModelli(filters: ListModelliFilters = {}): Promise<ModelloApi[]> {
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
  const { rows } = await db.query<ModelloRow>(
    `SELECT ${SELECT_COLS} FROM b2b.modelli
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY nome NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows.map(rowToModello);
}

export async function getModello(id: string): Promise<ModelloApi | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query<ModelloRow>(`SELECT ${SELECT_COLS} FROM b2b.modelli WHERE id = $1`, [id]);
  return rows[0] ? rowToModello(rows[0]) : null;
}

export async function createModello(input: { nome: string; immagine?: string | null }): Promise<ModelloApi> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const id = newId();
  const { rows } = await db.query<ModelloRow>(
    `INSERT INTO b2b.modelli (id, nome, immagine, conteggio, sinonimo)
       VALUES ($1,$2,$3,0,'{}') RETURNING ${SELECT_COLS}`,
    [id, input.nome, input.immagine ?? null]
  );
  return rowToModello(rows[0]);
}

/**
 * Aggiorna nome/immagine. `immagine` è tri-state esplicito (null = rimuovi,
 * stringa = imposta) risolto dal chiamante — a differenza dell'originale
 * Firestore, che per un bug pre-esistente non riusciva mai a rimuovere
 * l'immagine (il campo veniva semplicemente omesso dall'update invece di
 * essere scritto a null). Se il nome cambia, il vecchio nome viene aggiunto
 * ai sinonimi (array_append, stesso comportamento di arrayUnion Firestore) —
 * la cascade sui prodotti collegati resta a carico del chiamante
 * (renameModelloProdotti in lib/prodottiDb.ts, già Postgres, non toccata qui).
 */
export async function updateModello(
  id: string,
  input: { nome: string; immagine: string | null }
): Promise<ModelloApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const current = await db.query<{ nome: string | null }>(`SELECT nome FROM b2b.modelli WHERE id = $1`, [id]);
  if (!current.rows[0]) return null;
  const oldNome = current.rows[0].nome;
  const renamed = oldNome !== null && oldNome !== input.nome;

  const { rows } = await db.query<ModelloRow>(
    `UPDATE b2b.modelli
       SET nome = $2,
           immagine = $3,
           sinonimo = CASE WHEN $4 THEN array_append(sinonimo, $5::text) ELSE sinonimo END
       WHERE id = $1
       RETURNING ${SELECT_COLS}`,
    [id, input.nome, input.immagine, renamed, oldNome]
  );
  return rows[0] ? rowToModello(rows[0]) : null;
}

export async function deleteModello(id: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(`DELETE FROM b2b.modelli WHERE id = $1`, [id]);
}
