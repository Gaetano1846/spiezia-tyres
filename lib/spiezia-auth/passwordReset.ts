// Reset password stateless per client nativi senza Firebase Auth SDK (app
// Flutter magazzino, Fase M port a Postgres). Nessuna tabella dedicata: il
// token è auto-descrittivo e firmato — {uid, exp} in base64url + HMAC-SHA256,
// stesso pattern di verifyInternalSecret/verifyWooWebhookSignature
// (lib/auth.ts). Il link va alla pagina web /reset-password, che posta a
// /api/auth/reset-password/confirm.

import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { hashPassword } from "./password";

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minuti

function sign(payload: string): string {
  const secret = process.env.PASSWORD_RESET_SECRET;
  if (!secret) throw new Error("PASSWORD_RESET_SECRET non configurato");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createResetToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyResetToken(token: string): { uid: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  let expectedSig: string;
  try {
    expectedSig = sign(payload);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as { uid: string; exp: number };
    if (!uid || typeof exp !== "number" || exp < Date.now()) return null;
    return { uid };
  } catch {
    return null;
  }
}

/** Imposta una nuova password argon2id per l'utente (upsert credenziale —
 *  sovrascrive anche un'eventuale credenziale firebase_scrypt storica). */
export async function setUserPassword(userId: string, newPassword: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const hash = await hashPassword(newPassword);
  await db.query(
    `INSERT INTO core.auth_credentials (user_id, algo, hash, salt, updated_at)
     VALUES ($1, 'argon2id', $2, NULL, now())
     ON CONFLICT (user_id) DO UPDATE SET algo = 'argon2id', hash = $2, salt = NULL, updated_at = now()`,
    [userId, hash]
  );
}
