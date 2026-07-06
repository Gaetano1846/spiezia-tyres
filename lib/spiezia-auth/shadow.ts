// Shadow-verify auth (Fase 1 migrazione Firebase→PG).
//
// A ogni login riuscito su Firebase, valida IN PARALLELO il path Postgres
// (core.utenti + core.auth_credentials) e logga l'esito su bridge.shadow_auth_log.
// Firebase resta autoritativo: qualunque errore qui NON tocca il login.
// Cutover solo dopo ≥1 settimana di log senza mismatch.
//
// SICUREZZA: la password non viene MAI loggata né persistita — solo esiti booleani.

import { getDb } from "@/lib/db";
import { verifyFirebaseScrypt, scryptParamsFromEnv } from "./firebaseScrypt";

export interface ShadowAuthInput {
  uid: string;
  email: string;
  password?: string;   // assente nei login legacy (form non aggiornato / retry vecchi client)
  ruolo: string;       // Ruolo dal doc Firestore (fonte autoritativa attuale)
  crm: boolean;
}

// stessa normalizzazione usata al backfill (mapping/utenti.mjs in Spiezia-DB)
const RUOLI = new Map([
  ["admin", "Admin"], ["magazziniere", "Magazziniere"], ["gommista", "Gommista"],
  ["grossista", "Grossista"], ["privato", "Privato"], ["t24", "T24"],
  ["rappresentante", "Rappresentante"], ["impiegato", "Impiegato"],
]);
function normalizeRuolo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  return RUOLI.get(key) ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** Fire-and-forget: chiamare con `void runShadowAuthCheck(...)`. Non lancia mai. */
export async function runShadowAuthCheck(input: ShadowAuthInput): Promise<void> {
  const db = getDb();
  if (!db) return; // DATABASE_URL non configurata (dev/build) → shadow disattivo

  const dettagli: Record<string, unknown> = {};
  let esito: "ok" | "mismatch" | "errore" = "ok";

  try {
    const { rows } = await db.query(
      `SELECT u.email, u.ruolo, u.crm, u.disabled, c.algo, c.hash, c.salt
         FROM core.utenti u
         LEFT JOIN core.auth_credentials c ON c.user_id = u.id
        WHERE u.id = $1`,
      [input.uid]
    );

    if (rows.length === 0) {
      esito = "mismatch";
      dettagli.utente_presente = false;
    } else {
      const row = rows[0];
      dettagli.utente_presente = true;

      dettagli.email_match = row.email === input.email.toLowerCase();
      dettagli.ruolo_match = row.ruolo === normalizeRuolo(input.ruolo);
      dettagli.crm_match = row.crm === input.crm;
      dettagli.disabled = row.disabled;

      if (!input.password) {
        dettagli.password_check = "saltato (password non fornita)";
      } else if (!row.hash) {
        dettagli.password_check = "nessuna credenziale in PG";
        esito = "mismatch";
      } else if (row.algo === "firebase_scrypt") {
        const params = scryptParamsFromEnv();
        if (!params) {
          dettagli.password_check = "parametri scrypt mancanti in env";
          esito = "errore";
        } else {
          const ok = verifyFirebaseScrypt(input.password, row.hash, row.salt, params);
          dettagli.password_check = ok ? "ok" : "FALLITA";
          if (!ok) esito = "mismatch";
        }
      } else {
        // argon2id compare solo dopo il cutover (re-hash) — in shadow non previsto
        dettagli.password_check = `algo inatteso in shadow: ${row.algo}`;
      }

      if (!dettagli.email_match || !dettagli.ruolo_match || !dettagli.crm_match) {
        esito = "mismatch";
      }
    }
  } catch (err) {
    esito = "errore";
    dettagli.errore = err instanceof Error ? err.message : String(err);
  }

  try {
    await db.query(
      `INSERT INTO bridge.shadow_auth_log (uid, email, esito, dettagli) VALUES ($1, $2, $3, $4)`,
      [input.uid, input.email.toLowerCase(), esito, dettagli]
    );
  } catch (err) {
    console.error("[shadow-auth] insert log fallito:", err instanceof Error ? err.message : err);
  }

  if (esito !== "ok") {
    console.error(`[shadow-auth] ${esito} per uid=${input.uid}:`, JSON.stringify(dettagli));
  }
}
