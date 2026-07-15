// Risoluzione "clienti assegnati a un rappresentante" — condivisa dalle route
// /api/rappresentante/ordini (lista), /api/rappresentante/ordini/[id]
// (dettaglio + controllo autorizzazione), /api/rappresentante/clienti
// (picker "ordina per conto di") e /api/checkout/cliente/[id]/indirizzi.
//
// Il collegamento cliente→rappresentante viveva su users/{uid}.Rappresentante
// (Firestore) — letto ora direttamente da Postgres: core.utenti.fs_extra->>
// 'Rappresentante' (email del rappresentante, assegnato da admin/clienti).
// Non è mai stata promossa a colonna dedicata (verificato sullo schema reale
// core.utenti — solo id/email/display_name/.../fs_extra jsonb), stesso
// pattern già usato da checkAndDecrementFido (lib/clientiDb.ts) per lo stesso
// campo. Il collegamento utente→anagrafica Clienti (core.clienti.utente_id)
// è risolto nella STESSA query via LEFT JOIN, invece di un round-trip
// separato come quando l'enumerazione utenti passava da Firestore.
//
// Verificato sul DB prod (2026-07): 268 utenti con fs_extra ? 'Rappresentante',
// 218 con valore vuoto (non assegnati) e il resto ripartito su singoli
// rappresentanti — un confronto di uguaglianza stretta con l'email esclude
// naturalmente le righe vuote/non assegnate.

import { getDb } from "@/lib/db";

export interface ClienteAssegnato {
  uid: string;
  nome: string;
  clienteRefId: string | null;
}

export async function getClientiAssegnati(repEmail: string): Promise<ClienteAssegnato[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(
    `SELECT u.id AS uid,
            coalesce(NULLIF(u.display_name, ''), u.email::text, u.id) AS nome,
            c.id AS cliente_ref_id
       FROM core.utenti u
       LEFT JOIN core.clienti c ON c.utente_id = u.id
      WHERE u.fs_extra->>'Rappresentante' = $1`,
    [repEmail]
  );
  return rows.map((r) => ({
    uid: r.uid as string,
    nome: r.nome as string,
    clienteRefId: (r.cliente_ref_id as string) ?? null,
  }));
}
