// Accesso Postgres al dominio Pop-Up (Fase 6 — cutover app→Postgres).
// b2b.popups è ora la fonte autoritativa per le scritture: il bridge le
// propaga a Firestore, così il CRM FlutterFlow legacy continua a vederle.

import { getDb, newId } from "@/lib/db";

export interface PopupApi {
  id: string;
  Titolo: string;
  Descrizione?: string;
  Immagine?: string;
  Link?: string;
  ButtonText?: string;
  Attivo: boolean;
}

function rowToPopup(r: Record<string, unknown>): PopupApi {
  return {
    id: r.id as string,
    Titolo: (r.nome as string) ?? "",
    Descrizione: (r.descrizione as string) ?? undefined,
    Immagine: (r.immagine as string) ?? undefined,
    Link: (r.link as string) ?? undefined,
    ButtonText: (r.button_text as string) ?? undefined,
    Attivo: r.attivo as boolean,
  };
}

export async function listPopups(): Promise<PopupApi[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(`SELECT * FROM b2b.popups ORDER BY nome`);
  return rows.map(rowToPopup);
}

/** Pop-up attivi non ancora visti da uid — per B2BPopUp (client-facing). */
export async function listActivePopupsForUser(uid: string): Promise<PopupApi[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(
    `SELECT * FROM b2b.popups WHERE attivo = true AND NOT ($1 = ANY(utenti_avvisati))`,
    [uid]
  );
  return rows.map(rowToPopup);
}

export interface PopupInput {
  titolo: string;
  descrizione?: string;
  immagine?: string;
  link?: string;
  buttonText?: string;
  attivo: boolean;
}

export async function createPopup(input: PopupInput): Promise<PopupApi> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const id = newId();
  const { rows } = await db.query(
    `INSERT INTO b2b.popups (id, nome, descrizione, immagine, link, button_text, attivo)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, input.titolo, input.descrizione || null, input.immagine || null,
     input.link || null, input.buttonText || null, input.attivo]
  );
  return rowToPopup(rows[0]);
}

export async function updatePopup(id: string, input: Partial<PopupInput>): Promise<PopupApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const { rows } = await db.query(
    `UPDATE b2b.popups SET
       nome = coalesce($2, nome), descrizione = coalesce($3, descrizione),
       immagine = coalesce($4, immagine), link = coalesce($5, link),
       button_text = coalesce($6, button_text), attivo = coalesce($7, attivo)
     WHERE id = $1 RETURNING *`,
    [id, input.titolo, input.descrizione, input.immagine, input.link, input.buttonText, input.attivo]
  );
  return rows[0] ? rowToPopup(rows[0]) : null;
}

export async function deletePopup(id: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(`DELETE FROM b2b.popups WHERE id = $1`, [id]);
}

/** Segna il pop-up come visto da uid (arrayUnion-equivalente, idempotente). */
export async function dismissPopup(id: string, uid: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(
    `UPDATE b2b.popups SET utenti_avvisati = array_append(utenti_avvisati, $2)
     WHERE id = $1 AND NOT ($2 = ANY(utenti_avvisati))`,
    [id, uid]
  );
}
