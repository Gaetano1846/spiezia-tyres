// Verifica password con lo scrypt modificato di Firebase Auth (zero dipendenze).
// Vendored da Spiezia-DB/auth/firebase-scrypt.mjs — tenere allineati.
//
// Algoritmo (github.com/firebase/scrypt):
//   1. derived = scrypt(password, salt ++ saltSeparator, N=2^memCost, r=rounds, p=1, 32 byte)
//   2. hash    = AES-256-CTR(key=derived, iv=0x00*16).encrypt(signerKey)
//   3. confronto costante con il passwordHash esportato

import { scryptSync, createCipheriv, timingSafeEqual } from "node:crypto";

export interface FirebaseScryptParams {
  signerKey: string;      // base64
  saltSeparator: string;  // base64
  rounds: number;         // es. 8
  memCost: number;        // es. 14 (N = 2^memCost)
}

export function verifyFirebaseScrypt(
  password: string,
  passwordHashB64: string,
  saltB64: string,
  params: FirebaseScryptParams
): boolean {
  const { signerKey, saltSeparator, rounds, memCost } = params;
  if (!password || !passwordHashB64 || !saltB64) return false;

  const salt = Buffer.concat([
    Buffer.from(saltB64, "base64"),
    Buffer.from(saltSeparator, "base64"),
  ]);

  const N = 2 ** memCost;
  const derived = scryptSync(Buffer.from(password, "utf8"), salt, 32, {
    N,
    r: rounds,
    p: 1,
    maxmem: 256 * N * rounds,
  });

  const cipher = createCipheriv("aes-256-ctr", derived, Buffer.alloc(16, 0));
  const computed = Buffer.concat([
    cipher.update(Buffer.from(signerKey, "base64")),
    cipher.final(),
  ]);

  const expected = Buffer.from(passwordHashB64, "base64");
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

/** Parametri di progetto dalle env (settate sul VPS, mai committate). */
export function scryptParamsFromEnv(): FirebaseScryptParams | null {
  const signerKey = process.env.SPIEZIA_SCRYPT_SIGNER_KEY;
  const saltSeparator = process.env.SPIEZIA_SCRYPT_SALT_SEPARATOR;
  const rounds = Number(process.env.SPIEZIA_SCRYPT_ROUNDS);
  const memCost = Number(process.env.SPIEZIA_SCRYPT_MEM_COST);
  if (!signerKey || !saltSeparator || !Number.isFinite(rounds) || !Number.isFinite(memCost)) {
    return null;
  }
  return { signerKey, saltSeparator, rounds, memCost };
}
