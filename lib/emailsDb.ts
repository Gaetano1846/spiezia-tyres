// Accesso Postgres al dominio Emails (decommissioning finale Firebase).
// b2b.emails è ora la fonte autoritativa per lettura/scrittura: il bridge
// (Spiezia-DB, migration 029) le propaga a Firestore per eventuali lettori
// legacy residui, stesso pattern di lib/notificheDb.ts.
//
// Solo un sottoinsieme di campi ha colonna dedicata (from_addr, to_addr,
// subject, body, is_html, direzione, tipologia, source, order_match, uid,
// risposto, processed, seen, received_at) — i campi AI (Risposta_suggerita,
// aiNeedsReply, aiReason, aiProcessedAt, aiModel, aiSkipReason) e l'oggetto
// orderMatch completo vivono in fs_extra (jsonb), stesso pattern già usato
// per i campi "estesi" di Preventivi (F6g). `letta` non ha mai avuto una
// colonna propria: nel frontend viene sempre scritta in coppia con `seen`
// (mai divergente, verificato leggendo ogni call site) — qui la trattiamo
// come alias di `seen`.

import { getDb } from "@/lib/db";

export interface EmailApi {
  id: string;
  from: string | null;
  to: string | null;
  subject: string | null;
  body: string | null;
  html: boolean | null;
  receivedAt: string | null;
  tipologia: string | null;
  direzione: string | null;
  letta: boolean;
  seen: boolean;
  Risposto: boolean;
  Risposta_suggerita: string | null;
}

interface EmailRow {
  id: string;
  from_addr: string | null;
  to_addr: string | null;
  subject: string | null;
  body: string | null;
  is_html: boolean | null;
  received_at: Date | null;
  tipologia: string | null;
  direzione: string | null;
  seen: boolean;
  risposto: boolean;
  fs_extra: Record<string, unknown> | null;
}

function rowToEmail(r: EmailRow): EmailApi {
  const extra = r.fs_extra ?? {};
  return {
    id: r.id,
    from: r.from_addr,
    to: r.to_addr,
    subject: r.subject,
    body: r.body,
    html: r.is_html,
    receivedAt: r.received_at ? r.received_at.toISOString() : null,
    tipologia: r.tipologia,
    direzione: r.direzione,
    letta: r.seen,
    seen: r.seen,
    Risposto: r.risposto,
    Risposta_suggerita: (extra.Risposta_suggerita as string | undefined) ?? null,
  };
}

const SELECT_COLS = `
  id, from_addr, to_addr, subject, body, is_html, received_at,
  tipologia, direzione, seen, risposto, fs_extra
`;

export interface ListEmailsFilters {
  direzione?: string;
  tipologia?: string;
  risposto?: boolean;
  search?: string;
  limit?: number;
}

export async function listEmails(filters: ListEmailsFilters = {}): Promise<EmailApi[]> {
  const db = getDb();
  if (!db) return [];

  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.direzione) {
    params.push(filters.direzione);
    where.push(`direzione = $${params.length}`);
  }
  if (filters.tipologia) {
    params.push(filters.tipologia);
    where.push(`tipologia = $${params.length}`);
  }
  if (filters.risposto !== undefined) {
    params.push(filters.risposto);
    where.push(`risposto = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(from_addr ILIKE $${params.length} OR subject ILIKE $${params.length} OR body ILIKE $${params.length})`);
  }

  const limit = Math.min(filters.limit ?? 200, 500);
  params.push(limit);

  const { rows } = await db.query<EmailRow>(
    `SELECT ${SELECT_COLS} FROM b2b.emails
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY received_at DESC NULLS LAST
       LIMIT $${params.length}`,
    params
  );
  return rows.map(rowToEmail);
}

export async function getEmail(id: string): Promise<EmailApi | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query<EmailRow>(`SELECT ${SELECT_COLS} FROM b2b.emails WHERE id = $1`, [id]);
  return rows[0] ? rowToEmail(rows[0]) : null;
}

/** Segna letta/vista — sempre coppia, stesso invariante del frontend originale. */
export async function markEmailRead(id: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(`UPDATE b2b.emails SET seen = true WHERE id = $1`, [id]);
}

/** Segna risposta inviata (implica anche letta/vista, stesso comportamento della pagina). */
export async function markEmailReplied(id: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(`UPDATE b2b.emails SET risposto = true, seen = true WHERE id = $1`, [id]);
}

/**
 * Scrive il risultato della generazione AI (lib/emailAdmin/aiReply.js).
 * `processedAi`/`orderMatch` hanno colonna dedicata (processed/order_match);
 * il resto (Risposta_suggerita, aiNeedsReply, aiReason, aiProcessedAt,
 * aiModel, aiSkipReason) va in fs_extra — merge shallow, non sovrascrive
 * altri campi extra già presenti.
 */
export async function updateEmailAiResult(
  id: string,
  input: {
    orderMatch: { vendor: string; orderId: string | null; ordineRefPath: string | null; spedizioneRefPath: string | null } | null;
    extra: Record<string, unknown>;
  }
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const orderMatchId = input.orderMatch?.orderId ?? null;
  const extraMerge = { ...input.extra, orderMatch: input.orderMatch };
  await db.query(
    `UPDATE b2b.emails
       SET processed = true, order_match = $2, fs_extra = fs_extra || $3::jsonb
       WHERE id = $1`,
    [id, orderMatchId, JSON.stringify(extraMerge)]
  );
}
