// Accesso Postgres al dominio Logs Magazzino (Fase M — port app Flutter
// "Spiezia Tyres" a Postgres). Audit trail movimenti magazzino: letto dallo
// screen Logs, scritto dallo screen Ordini ad ogni "Approva" articolo.
// Ultima collection Firestore-only del gruppo prima di questa fase — vedi
// mapping/logs_magazzino.mjs nel repo Spiezia-DB per il bridge bidirezionale.

import { getDb, newId } from "@/lib/db";

export interface LogMagazzinoApi {
  id: string;
  Data: string | null;
  UtenteId: string | null;
  UtenteNome: string | null;
  Azione: string;
  Quantita: number;
  ProdottoId: string | null;
  ProdottoLabel: string | null;
  GabbiaId: string | null;
  Motivo: string | null;
  SedeId: string | null;
  SedeNome: string | null;
}

function rowToLog(r: Record<string, unknown>): LogMagazzinoApi {
  const marca = (r.prodotto_marca as string) ?? null;
  const modello = (r.prodotto_modello as string) ?? null;
  return {
    id: r.id as string,
    Data: r.data ? (r.data as Date).toISOString() : null,
    UtenteId: (r.utente_id as string) ?? null,
    UtenteNome: (r.utente_nome as string) ?? null,
    Azione: (r.azione as string) ?? "",
    Quantita: Number(r.quantita ?? 0),
    ProdottoId: (r.prodotto_id as string) ?? null,
    ProdottoLabel: marca || modello ? [marca, modello].filter(Boolean).join(" ") : null,
    GabbiaId: (r.gabbia_id as string) ?? null,
    Motivo: (r.motivo as string) ?? null,
    SedeId: (r.sede_id as string) ?? null,
    SedeNome: (r.sede_nome as string) ?? null,
  };
}

export interface ListLogsMagazzinoFilters {
  dataDa?: string;
  dataA?: string;
  azione?: string;
  prodottoId?: string;
  limit?: number;
}

/** Lista log magazzino con filtri — sostituisce PagedListView Firestore
 *  (screen Logs) e la ricerca per prodotto (queryLogsMagazzinoRecordOnce). */
export async function listLogsMagazzino(filters: ListLogsMagazzinoFilters = {}): Promise<LogMagazzinoApi[]> {
  const db = getDb();
  if (!db) return [];

  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (filters.dataDa) where.push(`l.data >= ${push(filters.dataDa)}`);
  if (filters.dataA) where.push(`l.data <= ${push(filters.dataA)}`);
  if (filters.azione) where.push(`l.azione = ${push(filters.azione)}`);
  if (filters.prodottoId) where.push(`l.prodotto_id = ${push(filters.prodottoId)}`);

  const limit = filters.limit ?? 200;
  const { rows } = await db.query(
    `SELECT l.*, u.display_name AS utente_nome, sede.nome AS sede_nome,
            p.marca AS prodotto_marca, p.modello AS prodotto_modello
       FROM b2b.logs_magazzino l
       LEFT JOIN core.utenti u ON u.id = l.utente_id
       LEFT JOIN core.sedi sede ON sede.id = l.sede_id
       LEFT JOIN public.prodotti p ON p.id = l.prodotto_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY l.data DESC NULLS LAST
       LIMIT ${push(limit)}`,
    params
  );
  return rows.map(rowToLog);
}

export interface AppendLogMagazzinoInput {
  utenteId?: string | null;
  azione: string;
  quantita: number;
  prodottoId?: string | null;
  gabbiaId?: string | null;
  motivo?: string | null;
  sedeId?: string | null;
}

/** Registra un movimento magazzino — mirror di createLogsMagazzinoRecordData
 *  (app Flutter, scritto ad ogni "Approva" articolo nello screen Ordini). */
export async function appendLogMagazzino(input: AppendLogMagazzinoInput): Promise<string> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const id = newId();
  await db.query(
    `INSERT INTO b2b.logs_magazzino (id, data, utente_id, azione, quantita, prodotto_id, gabbia_id, motivo, sede_id)
     VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8)`,
    [id, input.utenteId ?? null, input.azione, input.quantita, input.prodottoId ?? null,
     input.gabbiaId ?? null, input.motivo ?? null, input.sedeId ?? null]
  );
  return id;
}
