// Sessioni opache su Postgres (core.sessions) per l'auth VPS-native del nuovo
// B2B (Fase 1 cutover). Il cookie `spiezia_session` contiene un token opaco
// (prefisso `sp1_` per distinguerlo dal session-cookie Firebase legacy); nel DB
// si salva solo lo SHA-256 del token, mai il token in chiaro.
//
// getSession (lib/auth.ts) valida il token qui: se il cookie inizia con `sp1_`
// → path Postgres; altrimenti → fallback Firebase.

import { randomBytes, createHash } from "node:crypto";
import type { SessionPayload } from "@/lib/types";
import { getDb, newId } from "@/lib/db";

export const PG_TOKEN_PREFIX = "sp1_";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function normalizeRuolo(raw: unknown): string {
  const s = String(raw ?? "Privato");
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Crea una sessione PG per l'utente e ritorna il token opaco da mettere nel
 * cookie (già prefissato). Ritorna null se il DB non è configurato.
 */
export async function createPgSession(
  userId: string,
  roleSnapshot: { Ruolo: string; CRM: boolean },
  meta?: { ip?: string; userAgent?: string },
): Promise<string | null> {
  const db = getDb();
  if (!db) return null;

  const rawToken = PG_TOKEN_PREFIX + randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.query(
    `INSERT INTO core.sessions (id, user_id, app, token_hash, role_snapshot, ip, user_agent, expires_at)
     VALUES ($1, $2, 'b2b', $3, $4, $5, $6, $7)`,
    [newId(), userId, tokenHash, JSON.stringify(roleSnapshot), meta?.ip ?? null, meta?.userAgent ?? null, expiresAt],
  );
  // aggiorna last_login (best-effort)
  db.query(`UPDATE core.utenti SET last_login = now() WHERE id = $1`, [userId]).catch(() => {});

  return rawToken;
}

/**
 * Valida un token di sessione PG e ritorna il payload utente (ruolo LIVE da
 * core.utenti, così un cambio ruolo ha effetto senza ri-login). null se
 * assente/scaduto/revocato/utente disabilitato.
 */
export async function getPgSession(rawToken: string): Promise<SessionPayload | null> {
  if (!rawToken?.startsWith(PG_TOKEN_PREFIX)) return null;
  const db = getDb();
  if (!db) return null;

  try {
    const { rows } = await db.query(
      `SELECT s.user_id, s.expires_at, s.revoked_at, u.email, u.ruolo, u.crm, u.disabled
         FROM core.sessions s
         JOIN core.utenti u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.app = 'b2b'`,
      [hashToken(rawToken)],
    );
    if (rows.length === 0) return null;
    const r = rows[0] as {
      user_id: string; expires_at: Date; revoked_at: Date | null;
      email: string | null; ruolo: string | null; crm: boolean; disabled: boolean;
    };
    if (r.revoked_at) return null;
    if (r.disabled) return null;
    if (new Date(r.expires_at).getTime() < Date.now()) return null;

    return {
      uid: r.user_id,
      email: r.email ?? "",
      Ruolo: normalizeRuolo(r.ruolo) as SessionPayload["Ruolo"],
      CRM: Boolean(r.crm),
    };
  } catch (err) {
    console.error("[auth] getPgSession error:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Revoca la sessione PG associata al token (logout). No-op se non è un token PG. */
export async function revokePgSession(rawToken: string | undefined): Promise<void> {
  if (!rawToken?.startsWith(PG_TOKEN_PREFIX)) return;
  const db = getDb();
  if (!db) return;
  try {
    await db.query(
      `UPDATE core.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(rawToken)],
    );
  } catch (err) {
    console.error("[auth] revokePgSession error:", err instanceof Error ? err.message : err);
  }
}

/** Trova un utente per email (per il login PG-native). Ritorna id+ruolo o null. */
export async function findUserByEmail(email: string): Promise<{ id: string; Ruolo: string; CRM: boolean; disabled: boolean } | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const { rows } = await db.query(
      `SELECT id, ruolo, crm, disabled FROM core.utenti WHERE email = $1 AND origine = 'b2b' LIMIT 1`,
      [email.toLowerCase()],
    );
    if (rows.length === 0) {
      // fallback senza vincolo origine (alcuni utenti storici potrebbero avere origine diversa)
      const alt = await db.query(
        `SELECT id, ruolo, crm, disabled FROM core.utenti WHERE email = $1 ORDER BY (origine='b2b') DESC LIMIT 1`,
        [email.toLowerCase()],
      );
      if (alt.rows.length === 0) return null;
      const a = alt.rows[0];
      return { id: a.id, Ruolo: normalizeRuolo(a.ruolo), CRM: Boolean(a.crm), disabled: Boolean(a.disabled) };
    }
    const r = rows[0];
    return { id: r.id, Ruolo: normalizeRuolo(r.ruolo), CRM: Boolean(r.crm), disabled: Boolean(r.disabled) };
  } catch (err) {
    console.error("[auth] findUserByEmail error:", err instanceof Error ? err.message : err);
    return null;
  }
}
