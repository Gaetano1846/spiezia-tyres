// Accesso Postgres al dominio Promozioni (Fase 6 — cutover app→Postgres).
// b2b.promozioni è ora la fonte autoritativa per le scritture: il bridge le
// propaga a Firestore, così il CRM FlutterFlow legacy continua a vederle.
//
// La lettura customer-facing (fetchPromozioniUtente in lib/promozioni.ts,
// usata da carrello/checkout per applicare gli sconti) resta VOLUTAMENTE su
// Firestore diretto — adiacente al dominio Ordini/checkout, esplicitamente
// escluso dal piano di migrazione. Solo il CRUD admin è cutover qui.

import { getDb, newId } from "@/lib/db";

export interface PromozioneApi {
  id: string;
  BrandNome: string[];
  Stagione: string[];
  Raggio: string[];
  Settore: string | null;
  ClientiIds: string[];
  Attiva: boolean;
  Scadenza: string | null;
  Fisso: boolean;
  Importo: number | null;
  CreatedAt: string | null;
}

function rowToPromozione(r: Record<string, unknown>): PromozioneApi {
  return {
    id: r.id as string,
    BrandNome: (r.brand_nome as string[]) ?? [],
    Stagione: (r.stagione as string[]) ?? [],
    Raggio: (r.raggio as string[]) ?? [],
    Settore: (r.settore as string) ?? null,
    ClientiIds: (r.clienti_ids as string[]) ?? [],
    Attiva: (r.attiva as boolean) ?? false,
    Scadenza: r.scadenza ? (r.scadenza as Date).toISOString() : null,
    Fisso: (r.fisso as boolean) ?? false,
    Importo: r.importo != null ? Number(r.importo) : null,
    CreatedAt: r.created_at ? (r.created_at as Date).toISOString() : null,
  };
}

export async function listPromozioni(limit = 200): Promise<PromozioneApi[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(
    `SELECT * FROM b2b.promozioni ORDER BY scadenza DESC NULLS LAST LIMIT $1`,
    [limit]
  );
  return rows.map(rowToPromozione);
}

export interface PromozioneInput {
  brandNome: string[];
  stagione: string[];
  raggio: string[];
  clientiIds: string[];
  attiva: boolean;
  scadenza: string;
  fisso: boolean;
  importo: number;
}

export async function createPromozione(input: PromozioneInput): Promise<PromozioneApi> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const id = newId();
  await db.query(
    `INSERT INTO b2b.promozioni
       (id, brand_nome, stagione, raggio, clienti_ids, attiva, scadenza, fisso, importo, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
    [id, input.brandNome, input.stagione, input.raggio, input.clientiIds,
     input.attiva, input.scadenza, input.fisso, input.importo]
  );
  const { rows } = await db.query(`SELECT * FROM b2b.promozioni WHERE id = $1`, [id]);
  return rowToPromozione(rows[0]);
}

export async function updatePromozione(id: string, input: PromozioneInput): Promise<PromozioneApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const { rows } = await db.query(
    `UPDATE b2b.promozioni SET
       brand_nome = $2, stagione = $3, raggio = $4, clienti_ids = $5,
       attiva = $6, scadenza = $7, fisso = $8, importo = $9
     WHERE id = $1
     RETURNING *`,
    [id, input.brandNome, input.stagione, input.raggio, input.clientiIds,
     input.attiva, input.scadenza, input.fisso, input.importo]
  );
  return rows[0] ? rowToPromozione(rows[0]) : null;
}

export async function deletePromozione(id: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(`DELETE FROM b2b.promozioni WHERE id = $1`, [id]);
}
