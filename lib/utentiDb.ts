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

export interface UtenteProfile {
  uid: string;
  email: string | null;
  display_name: string | null;
  photo_url: string | null;
  phone_number: string | null;
  Ruolo: string | null;
  CRM: boolean;
  Sede: string | null;
  SedeNome: string | null;
  Reparto: string | null;
  Mansione: string | null;
  Cliente: boolean;
  Rappresentante: string | null;
  Blocco: boolean;
  PrinterMAC: string | null;
  Fido: number | null;
  Fido_Residuo: number | null;
  created_time: string | null;
}

/**
 * Profilo esteso dell'utente autenticato — fonte unica lato client per
 * AuthProvider (niente più letture dirette a Firestore/onAuthStateChanged,
 * vedi components/layout/AuthProvider.tsx) e per client nativi senza accesso
 * diretto al doc Firestore `users/{uid}` (es. app Flutter magazzino).
 * Campi non mappati su colonne dedicate (PrinterMAC, Cliente, Blocco,
 * Rappresentante) vivono in core.utenti.fs_extra — vedi mapping/utenti.mjs.
 */
export async function getUtenteProfile(id: string): Promise<UtenteProfile | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.display_name, u.photo_url, u.telefono, u.ruolo, u.crm,
            u.sede_id, s.nome AS sede_nome, u.reparto_id, u.mansione_id, u.fido,
            u.fido_residuo, u.fs_extra, u.created_at
       FROM core.utenti u
       LEFT JOIN core.sedi s ON s.id = u.sede_id
      WHERE u.id = $1`,
    [id]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const extra = (r.fs_extra ?? {}) as Record<string, unknown>;
  return {
    uid: r.id,
    email: r.email ?? null,
    display_name: r.display_name ?? null,
    photo_url: r.photo_url ?? null,
    phone_number: r.telefono ?? null,
    Ruolo: r.ruolo ?? null,
    CRM: Boolean(r.crm),
    Sede: r.sede_id ?? null,
    SedeNome: r.sede_nome ?? null,
    Reparto: r.reparto_id ?? null,
    Mansione: r.mansione_id ?? null,
    Cliente: extra.Cliente === true,
    Rappresentante: typeof extra.Rappresentante === "string" ? extra.Rappresentante : null,
    Blocco: extra.Blocco === true,
    PrinterMAC: typeof extra.PrinterMAC === "string" ? extra.PrinterMAC : null,
    Fido: r.fido != null ? Number(r.fido) : null,
    Fido_Residuo: r.fido_residuo != null ? Number(r.fido_residuo) : null,
    created_time: r.created_at ? new Date(r.created_at).toISOString() : null,
  };
}

/**
 * Aggiorna il MAC della stampante Zebra assegnata all'utente (selezionata
 * dal magazziniere nel side menu dell'app Flutter). Vive in fs_extra come
 * gli altri campi non colonnari — merge via jsonb_set, non tocca il resto.
 */
export async function updatePrinterMac(uid: string, printerMac: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(
    `UPDATE core.utenti
        SET fs_extra = jsonb_set(coalesce(fs_extra, '{}'::jsonb), '{PrinterMAC}', to_jsonb($2::text))
      WHERE id = $1`,
    [uid, printerMac]
  );
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
