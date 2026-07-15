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
  UtentiAvvisati: boolean;
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
    UtentiAvvisati: extra.utentiAvvisati === true,
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

export interface UpdateUtenteAccountInput {
  Ruolo?: string;
  DisplayName?: string;
  Rappresentante?: string;
  MetodoPagamento?: string;
  Blocco?: boolean;
  /** Fido "fallback" quando l'utente non ha un Cliente collegato — quando
   *  presente c'è già un core.clienti linkato, preferire PATCH /api/clienti/:id. */
  Fido?: number;
}

/** Aggiorna i campi account (pagina admin/clienti) che vivono su core.utenti
 *  — Ruolo/Rappresentante/MetodoPagamento/Blocco in fs_extra (stesso motivo
 *  di PrinterMAC: non hanno ancora colonne dedicate), Fido sulla colonna
 *  reale (per utenti senza Cliente collegato, chiude lo split-brain anche
 *  in questo caso limite). */
export async function updateUtenteAccount(uid: string, input: UpdateUtenteAccountInput): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");

  const extraPatches: Record<string, unknown> = {};
  if (input.Ruolo !== undefined) extraPatches.Ruolo = input.Ruolo;
  if (input.Rappresentante !== undefined) extraPatches.Rappresentante = input.Rappresentante;
  if (input.MetodoPagamento !== undefined) extraPatches.Metodo_di_Pagamento = input.MetodoPagamento;
  if (input.Blocco !== undefined) extraPatches.Blocco = input.Blocco;

  await db.query(
    `UPDATE core.utenti
        SET display_name = coalesce($2, display_name),
            ruolo = coalesce($3, ruolo),
            fido = coalesce($4, fido),
            fs_extra = fs_extra || $5::jsonb
      WHERE id = $1`,
    [uid, input.DisplayName ?? null, input.Ruolo ?? null, input.Fido ?? null, JSON.stringify(extraPatches)]
  );
}

export interface UtenteListItem {
  id: string;
  email: string | null;
  displayName: string | null;
  ruolo: string | null;
  rappresentante: string | null;
  metodoPagamento: string | null;
  blocco: boolean;
  fido: number;
  fidoResiduo: number;
  lastLogin: string | null;
  /** core.clienti.id collegato (via core.clienti.utente_id), se presente. */
  clienteId: string | null;
}

export interface ListUtentiParams {
  search?: string;
  ruolo?: string;
  limit?: number;
  offset?: number;
}

/**
 * Lista paginata di core.utenti per la pagina admin/clienti — sostituisce
 * useFirestoreInfiniteList(collectionPath:"users"), che leggeva Firestore
 * direttamente dal browser via Firebase Web SDK. Rappresentante/MetodoPagamento/
 * Blocco vivono in fs_extra (vedi updateUtenteAccount sopra); clienteId risolve
 * l'anagrafica Clienti collegata via core.clienti.utente_id, stesso pattern di
 * getClientiAssegnati (lib/rappresentanteDb.ts).
 */
export async function listUtenti(params: ListUtentiParams = {}): Promise<UtenteListItem[]> {
  const db = getDb();
  if (!db) return [];

  const search = params.search?.trim() || null;
  const ruolo = params.ruolo?.trim() || null;
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);

  const { rows } = await db.query(
    `SELECT u.id, u.email, u.display_name, u.ruolo, u.fido, u.fido_residuo, u.last_login,
            u.fs_extra->>'Rappresentante' AS rappresentante,
            u.fs_extra->>'Metodo_di_Pagamento' AS metodo_pagamento,
            coalesce((u.fs_extra->>'Blocco')::boolean, false) AS blocco,
            c.id AS cliente_id
       FROM core.utenti u
       LEFT JOIN core.clienti c ON c.utente_id = u.id
      WHERE ($1::text IS NULL OR
             (coalesce(u.display_name, '') || ' ' || coalesce(u.email::text, '') || ' ' || coalesce(u.ruolo, ''))
             ILIKE $1)
        AND ($2::text IS NULL OR u.ruolo = $2)
      ORDER BY u.email ASC NULLS LAST, u.id ASC
      LIMIT $3 OFFSET $4`,
    [search ? `%${search}%` : null, ruolo, limit, offset]
  );

  return rows.map((r) => ({
    id: r.id as string,
    email: (r.email as string) ?? null,
    displayName: (r.display_name as string) ?? null,
    ruolo: (r.ruolo as string) ?? null,
    rappresentante: (r.rappresentante as string) ?? null,
    metodoPagamento: (r.metodo_pagamento as string) ?? null,
    blocco: Boolean(r.blocco),
    fido: r.fido != null ? Number(r.fido) : 0,
    fidoResiduo: r.fido_residuo != null ? Number(r.fido_residuo) : 0,
    lastLogin: r.last_login ? new Date(r.last_login as string).toISOString() : null,
    clienteId: (r.cliente_id as string) ?? null,
  }));
}

/** Marca il popup "contributo logistico" del carrello come già visto. */
export async function markUtentiAvvisati(uid: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(
    `UPDATE core.utenti
        SET fs_extra = jsonb_set(coalesce(fs_extra, '{}'::jsonb), '{utentiAvvisati}', 'true'::jsonb)
      WHERE id = $1`,
    [uid]
  );
}

/** Aggiorna il nome visualizzato dell'utente (self-service, pagina Account). */
export async function updateDisplayName(uid: string, displayName: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(`UPDATE core.utenti SET display_name = $2 WHERE id = $1`, [uid, displayName]);
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
