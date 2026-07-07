// Accesso Postgres ai lookup CRM di base (Fase 6 — cutover app→Postgres):
// Sede, Reparto, Mansione, Servizi, Categoria_Prodotti. core.sedi/b2b.* sono
// ora la fonte autoritativa per le scritture: il bridge le propaga a
// Firestore, così il CRM FlutterFlow legacy continua a vederle.

import { getDb, newId } from "@/lib/db";

export interface SimpleEntity {
  id: string;
  Nome: string;
  Indirizzo?: string;
  Citta?: string;
}

export interface SimpleEntityInput {
  nome: string;
  indirizzo?: string;
  citta?: string;
}

const TABLES = {
  sede: "core.sedi",
  reparto: "b2b.reparti",
  mansione: "b2b.mansioni",
  servizio: "b2b.servizi",
  categoria: "b2b.categorie_prodotto",
} as const;

export type LookupKind = keyof typeof TABLES;

const HAS_ADDRESS: Record<LookupKind, boolean> = {
  sede: true, reparto: false, mansione: false, servizio: false, categoria: false,
};

const NOME_COL: Record<LookupKind, string> = {
  sede: "nome", reparto: "nome", mansione: "nome", servizio: "titolo", categoria: "nome",
};

function rowToEntity(kind: LookupKind, r: Record<string, unknown>): SimpleEntity {
  return {
    id: r.id as string,
    Nome: (r[NOME_COL[kind]] as string) ?? "",
    ...(HAS_ADDRESS[kind] ? { Indirizzo: (r.indirizzo as string) ?? undefined, Citta: (r.citta as string) ?? undefined } : {}),
  };
}

export async function listLookup(kind: LookupKind): Promise<SimpleEntity[]> {
  const db = getDb();
  if (!db) return [];
  const table = TABLES[kind];
  const { rows } = await db.query(`SELECT * FROM ${table} ORDER BY ${NOME_COL[kind]}`);
  return rows.map((r) => rowToEntity(kind, r));
}

export async function createLookup(kind: LookupKind, input: SimpleEntityInput): Promise<SimpleEntity> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const table = TABLES[kind];
  const id = newId();
  if (kind === "sede") {
    const { rows } = await db.query(
      `INSERT INTO ${table} (id, nome, indirizzo, citta) VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, input.nome, input.indirizzo || null, input.citta || null]
    );
    return rowToEntity(kind, rows[0]);
  }
  const { rows } = await db.query(
    `INSERT INTO ${table} (id, ${NOME_COL[kind]}) VALUES ($1,$2) RETURNING *`,
    [id, input.nome]
  );
  return rowToEntity(kind, rows[0]);
}

export async function updateLookup(kind: LookupKind, id: string, input: SimpleEntityInput): Promise<SimpleEntity | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const table = TABLES[kind];
  if (kind === "sede") {
    const { rows } = await db.query(
      `UPDATE ${table} SET nome = $2, indirizzo = $3, citta = $4 WHERE id = $1 RETURNING *`,
      [id, input.nome, input.indirizzo || null, input.citta || null]
    );
    return rows[0] ? rowToEntity(kind, rows[0]) : null;
  }
  const { rows } = await db.query(
    `UPDATE ${table} SET ${NOME_COL[kind]} = $2 WHERE id = $1 RETURNING *`,
    [id, input.nome]
  );
  return rows[0] ? rowToEntity(kind, rows[0]) : null;
}

export async function deleteLookup(kind: LookupKind, id: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(`DELETE FROM ${TABLES[kind]} WHERE id = $1`, [id]);
}
