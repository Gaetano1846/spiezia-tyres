// Verifica/hash password per l'auth VPS-native del nuovo B2B (Fase 1 cutover).
//
// Due algoritmi convivono in core.auth_credentials.algo:
//  - 'firebase_scrypt': hash importati da Firebase Auth (1085 utenti storici).
//    Verificati con lo scrypt modificato di Firebase (firebaseScrypt.ts).
//  - 'argon2id': password NUOVE create dal nuovo B2B (es. clienti creati da un
//    operatore con password). Hashate via hash-wasm (WASM puro, portabile nel
//    build standalone Next — nessuna dipendenza nativa).
//
// La password non viene MAI loggata. Le funzioni tornano solo booleani/hash.

import { argon2id, argon2Verify } from "hash-wasm";
import { getDb } from "@/lib/db";
import { verifyFirebaseScrypt, scryptParamsFromEnv } from "./firebaseScrypt";

// Parametri argon2id: OWASP baseline (m=19MiB, t=2, p=1). hash-wasm produce una
// stringa PHC `$argon2id$...` che si auto-descrive → argon2Verify non ha bisogno
// dei parametri per verificare.
const ARGON2_MEMORY_KIB = 19456;
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISM = 1;

/** Hash argon2id (stringa PHC) per una nuova password. */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 6) {
    throw new Error("Password troppo corta (min 6 caratteri)");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return argon2id({
    password,
    salt,
    memorySize: ARGON2_MEMORY_KIB,
    iterations: ARGON2_ITERATIONS,
    parallelism: ARGON2_PARALLELISM,
    hashLength: 32,
    outputType: "encoded",
  });
}

export type VerifyResult =
  | { ok: true; algo: "firebase_scrypt" | "argon2id" }
  | { ok: false; reason: "no_user" | "no_credential" | "bad_password" | "scrypt_params_missing" | "error" };

/**
 * Verifica la password di un utente contro core.auth_credentials.
 * Non decide nulla su ruoli/sessioni — solo "la password è giusta?".
 */
export async function verifyUserPassword(userId: string, password: string): Promise<VerifyResult> {
  const db = getDb();
  if (!db) return { ok: false, reason: "error" };

  try {
    const { rows } = await db.query(
      `SELECT algo, hash, salt FROM core.auth_credentials WHERE user_id = $1`,
      [userId],
    );
    if (rows.length === 0) return { ok: false, reason: "no_credential" };

    const { algo, hash, salt } = rows[0] as { algo: string; hash: string; salt: string | null };

    if (algo === "argon2id") {
      const ok = await argon2Verify({ password, hash });
      return ok ? { ok: true, algo: "argon2id" } : { ok: false, reason: "bad_password" };
    }

    if (algo === "firebase_scrypt") {
      const params = scryptParamsFromEnv();
      if (!params) return { ok: false, reason: "scrypt_params_missing" };
      const ok = verifyFirebaseScrypt(password, hash, salt ?? "", params);
      return ok ? { ok: true, algo: "firebase_scrypt" } : { ok: false, reason: "bad_password" };
    }

    return { ok: false, reason: "error" };
  } catch (err) {
    console.error("[auth] verifyUserPassword error:", err instanceof Error ? err.message : err);
    return { ok: false, reason: "error" };
  }
}
