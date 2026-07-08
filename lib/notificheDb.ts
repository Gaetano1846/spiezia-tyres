// Accesso Postgres al dominio Notifiche (Fase 6 — cutover app→Postgres).
// b2b.notifiche è ora la fonte autoritativa per le scritture: il bridge le
// propaga a Firestore, così il CRM FlutterFlow legacy continua a vederle.
//
// Nota: Titolo/Tipo/Link non sono mai popolati nei dati reali (verificato
// campionando Firestore) — restano colonne esistenti ma sempre null/none.
// Nessun realtime SSE ancora costruito: il badge conteggio fa un fetch
// singolo, non uno stream come il vecchio onSnapshot Firestore.

import { getDb } from "@/lib/db";
import type { Notifica } from "@/lib/types";

// Come ClienteApi/VeicoloApi in clientiDb.ts: stessa forma di Notifica ma
// DataCreazione è una stringa ISO (JSON via API), non un Timestamp Firestore.
export type NotificaApi = Omit<Notifica, "DataCreazione"> & { DataCreazione: string };

function rowToNotifica(r: Record<string, unknown>): NotificaApi {
  return {
    id: r.id as string,
    Titolo: (r.titolo as string) ?? "",
    Testo: (r.testo as string) ?? "",
    Tipo: (r.tipo as Notifica["Tipo"]) ?? "sistema",
    Visto: r.visto as boolean,
    Link: (r.link as string) ?? undefined,
    DataCreazione: (r.created_at as Date).toISOString(),
  };
}

export async function listNotifiche(limit = 100): Promise<NotificaApi[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(
    `SELECT id, titolo, testo, tipo, visto, link, created_at
       FROM b2b.notifiche ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map(rowToNotifica);
}

/** Conteggio non lette. uid presente → filtra per utente_id (badge CRM); assente → globale (badge B2B header). */
export async function countUnread(uid?: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const { rows } = uid
    ? await db.query(`SELECT count(*)::int n FROM b2b.notifiche WHERE utente_id = $1 AND visto = false`, [uid])
    : await db.query(`SELECT count(*)::int n FROM b2b.notifiche WHERE visto = false`);
  return rows[0]?.n ?? 0;
}

export async function markAsRead(id: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(`UPDATE b2b.notifiche SET visto = true WHERE id = $1`, [id]);
}

/** Segna tutte le non lette come lette. Ritorna il numero di righe aggiornate. */
export async function markAllAsRead(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const { rowCount } = await db.query(`UPDATE b2b.notifiche SET visto = true WHERE visto = false`);
  return rowCount ?? 0;
}
