// Rubrica indirizzi self-service del cliente (pagina Account) — core.utenti_indirizzi,
// non da confondere con core.clienti_indirizzi (anagrafica CRM legata a un
// Cliente). Sostituisce le sottocollezioni Firestore
// users/{uid}/Indirizzo_Fatturazione|Indirizzo_Spedizione.

import { getDb, newId } from "@/lib/db";

export type IndirizzoTipo = "fatturazione" | "spedizione";

export interface IndirizzoUtente {
  id: string;
  Nome: string | null;
  Cognome: string | null;
  Azienda: string | null;
  Via: string | null;
  Civico: string | null;
  CAP: string | null;
  Citta: string | null;
  Provincia: string | null;
  Paese: string | null;
  Telefono: string | null;
  Partita_Iva: string | null;
}

export interface IndirizzoInput {
  Nome?: string;
  Cognome?: string;
  Azienda?: string;
  Via?: string;
  Civico?: string;
  CAP?: string;
  Citta?: string;
  Provincia?: string;
  Paese?: string;
  Telefono?: string;
  Partita_Iva?: string;
}

function toIndirizzo(r: Record<string, unknown>): IndirizzoUtente {
  return {
    id: r.id as string,
    Nome: (r.nome as string) ?? null,
    Cognome: (r.cognome as string) ?? null,
    Azienda: (r.azienda as string) ?? null,
    Via: (r.via as string) ?? null,
    Civico: (r.civico as string) ?? null,
    CAP: (r.cap as string) ?? null,
    Citta: (r.citta as string) ?? null,
    Provincia: (r.provincia as string) ?? null,
    Paese: (r.paese as string) ?? null,
    Telefono: (r.telefono as string) ?? null,
    Partita_Iva: (r.partita_iva as string) ?? null,
  };
}

export async function listIndirizziUtente(
  utenteId: string,
  tipo: IndirizzoTipo
): Promise<IndirizzoUtente[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(
    `SELECT * FROM core.utenti_indirizzi WHERE utente_id = $1 AND tipo = $2 ORDER BY updated_at DESC`,
    [utenteId, tipo]
  );
  return rows.map(toIndirizzo);
}

export async function createIndirizzoUtente(
  utenteId: string,
  tipo: IndirizzoTipo,
  input: IndirizzoInput
): Promise<IndirizzoUtente> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const id = newId();
  const { rows } = await db.query(
    `INSERT INTO core.utenti_indirizzi
       (id, utente_id, tipo, nome, cognome, azienda, via, civico, cap, citta, provincia, paese, telefono, partita_iva)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [id, utenteId, tipo, input.Nome ?? null, input.Cognome ?? null, input.Azienda ?? null,
      input.Via ?? null, input.Civico ?? null, input.CAP ?? null, input.Citta ?? null,
      input.Provincia ?? null, input.Paese ?? null, input.Telefono ?? null, input.Partita_Iva ?? null]
  );
  return toIndirizzo(rows[0]);
}

/** Aggiorna un indirizzo, scoped al proprietario — ritorna false se non trovato/non tuo. */
export async function updateIndirizzoUtente(
  utenteId: string,
  id: string,
  input: IndirizzoInput
): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const { rowCount } = await db.query(
    `UPDATE core.utenti_indirizzi
        SET nome=$3, cognome=$4, azienda=$5, via=$6, civico=$7, cap=$8, citta=$9,
            provincia=$10, paese=$11, telefono=$12, partita_iva=$13
      WHERE id = $1 AND utente_id = $2`,
    [id, utenteId, input.Nome ?? null, input.Cognome ?? null, input.Azienda ?? null,
      input.Via ?? null, input.Civico ?? null, input.CAP ?? null, input.Citta ?? null,
      input.Provincia ?? null, input.Paese ?? null, input.Telefono ?? null, input.Partita_Iva ?? null]
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteIndirizzoUtente(utenteId: string, id: string): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const { rowCount } = await db.query(
    `DELETE FROM core.utenti_indirizzi WHERE id = $1 AND utente_id = $2`,
    [id, utenteId]
  );
  return (rowCount ?? 0) > 0;
}
