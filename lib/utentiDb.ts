// Creazione di account "staff" (Rappresentante, e in futuro altri ruoli
// interni) — a differenza dei Clienti, non hanno un'anagrafica core.clienti
// collegata: solo l'identità di login su core.utenti + core.auth_credentials.

import { getDb, newId } from "@/lib/db";
import { hashPassword } from "@/lib/spiezia-auth/password";

export interface CreateRappresentanteInput {
  Nome: string;
  Email: string;
  Password: string;
}

/** Crea un account Rappresentante. Ritorna null se l'email esiste già. */
export async function createRappresentante(
  input: CreateRappresentanteInput
): Promise<{ id: string } | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");

  const email = input.Email.trim().toLowerCase();
  const existing = await db.query(
    `SELECT id FROM core.utenti WHERE email = $1 LIMIT 1`,
    [email]
  );
  if (existing.rows.length > 0) return null;

  // Hash PRIMA di aprire la transazione: se la password non è valida fallisce
  // subito, senza creare nulla.
  const passwordHash = await hashPassword(input.Password);
  const id = newId();

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO core.utenti (id, email, display_name, origine, ruolo, crm)
       VALUES ($1, $2, $3, 'b2b', 'Rappresentante', false)`,
      [id, email, input.Nome.trim()]
    );
    await client.query(
      `INSERT INTO core.auth_credentials (user_id, algo, hash)
       VALUES ($1, 'argon2id', $2)`,
      [id, passwordHash]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return { id };
}
