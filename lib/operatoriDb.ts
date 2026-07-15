// Accesso Postgres al dominio Operatori CRM (Fase 7 — prerequisito per il
// cutover di admin/operatori e dei picker "Operatore" in
// appuntamenti/fogli-di-lavoro). core.utenti è già la fonte autoritativa per
// gli account (auth VPS-native, Fase 1): questo modulo espone solo la fetta
// "operatore CRM" (crm = true, o Ruolo Admin) con Sede/Mansione/Reparto già
// risolti via JOIN — sostituisce le query dirette
// `collection(db,"users").where("CRM","==",true)` + resolve manuale dei
// DocumentReference sparse in ~4 pagine CRM/admin.
//
// Le scritture (create/update) vanno su core.utenti: il bridge esistente
// (trigger trg_bridge_outbox, non toccato qui) le propaga a Firestore per il
// CRM FlutterFlow legacy.

import { getDb, newId } from "@/lib/db";
import { hashPassword } from "@/lib/spiezia-auth/password";

export interface OperatoreApi {
  id: string;
  email: string;
  displayName?: string;
  Ruolo: string;
  CRM: boolean;
  SedeId?: string | null;
  MansioneId?: string | null;
  RepartoId?: string | null;
  SedeNome?: string;
  MansioneNome?: string;
  RepartoNome?: string;
}

function rowToOperatore(r: Record<string, unknown>): OperatoreApi {
  return {
    id: r.id as string,
    email: (r.email as string) ?? "",
    displayName: (r.display_name as string) ?? undefined,
    Ruolo: (r.ruolo as string) ?? "Impiegato",
    CRM: Boolean(r.crm),
    SedeId: (r.sede_id as string) ?? null,
    MansioneId: (r.mansione_id as string) ?? null,
    RepartoId: (r.reparto_id as string) ?? null,
    SedeNome: (r.sede_nome as string) ?? undefined,
    MansioneNome: (r.mansione_nome as string) ?? undefined,
    RepartoNome: (r.reparto_nome as string) ?? undefined,
  };
}

const SELECT_BASE = `
  SELECT u.*, s.nome AS sede_nome, m.nome AS mansione_nome, r.nome AS reparto_nome
    FROM core.utenti u
    LEFT JOIN core.sedi s ON s.id = u.sede_id
    LEFT JOIN b2b.mansioni m ON m.id = u.mansione_id
    LEFT JOIN b2b.reparti r ON r.id = u.reparto_id`;

/** Operatori CRM: crm=true oppure Ruolo Admin (un Admin storico potrebbe avere crm=false). */
export async function listOperatori(): Promise<OperatoreApi[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(
    `${SELECT_BASE} WHERE u.crm = true OR u.ruolo = 'Admin' ORDER BY coalesce(u.display_name, u.email)`
  );
  return rows.map(rowToOperatore);
}

export async function getOperatore(id: string): Promise<OperatoreApi | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query(`${SELECT_BASE} WHERE u.id = $1`, [id]);
  return rows[0] ? rowToOperatore(rows[0]) : null;
}

export interface CreateOperatoreInput {
  displayName: string;
  email: string;
  password: string;
  ruolo: string;
  sedeId?: string | null;
  mansioneId?: string | null;
  repartoId?: string | null;
}

/** Crea un operatore CRM (core.utenti + credenziale argon2id). null se l'email esiste già. */
export async function createOperatore(input: CreateOperatoreInput): Promise<OperatoreApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");

  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id FROM core.utenti WHERE email = $1 AND origine = 'b2b' LIMIT 1`,
      [email]
    );
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const id = newId();
    await client.query(
      `INSERT INTO core.utenti (id, email, display_name, origine, ruolo, crm, sede_id, mansione_id, reparto_id)
       VALUES ($1,$2,$3,'b2b',$4,true,$5,$6,$7)`,
      [id, email, input.displayName.trim(), input.ruolo, input.sedeId || null, input.mansioneId || null, input.repartoId || null]
    );
    await client.query(
      `INSERT INTO core.auth_credentials (user_id, algo, hash)
       VALUES ($1, 'argon2id', $2)
       ON CONFLICT (user_id) DO UPDATE SET algo = 'argon2id', hash = EXCLUDED.hash, updated_at = now()`,
      [id, passwordHash]
    );

    await client.query("COMMIT");
    return (await getOperatore(id))!;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export interface UpdateOperatoreInput {
  displayName?: string;
  ruolo?: string;
  crm?: boolean;
  sedeId?: string | null;
  mansioneId?: string | null;
  repartoId?: string | null;
}

export async function updateOperatore(id: string, input: UpdateOperatoreInput): Promise<OperatoreApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  // sede_id/mansione_id/reparto_id: assegnazione diretta (non coalesce) — il
  // form admin/operatori invia sempre lo stato pieno del select, "" → null
  // significa "rimuovi assegnazione" (stesso comportamento del vecchio
  // updateDoc Firestore con Sede/Mansione/Reparto: null).
  const { rows } = await db.query(
    `UPDATE core.utenti SET
       display_name = coalesce($2, display_name),
       ruolo = coalesce($3, ruolo),
       crm = coalesce($4, crm),
       sede_id = $5, mansione_id = $6, reparto_id = $7
     WHERE id = $1
     RETURNING id`,
    [id, input.displayName, input.ruolo, input.crm, input.sedeId ?? null, input.mansioneId ?? null, input.repartoId ?? null]
  );
  return rows[0] ? getOperatore(rows[0].id) : null;
}
