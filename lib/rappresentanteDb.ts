// Risoluzione "clienti assegnati a un rappresentante" — condivisa dalle route
// /api/rappresentante/ordini (lista), /api/rappresentante/ordini/[id]
// (dettaglio + controllo autorizzazione) e /api/rappresentante/clienti
// (picker "ordina per conto di"). Il collegamento cliente→rappresentante vive
// su users/{uid}.Rappresentante (email del rappresentante, assegnato da
// admin/clienti) — il dominio Ordini/Clienti resta Firestore-nativo per
// questa fase della migrazione.
//
// Il collegamento utente→anagrafica Clienti (Cliente_Ref) va invece risolto
// da POSTGRES (core.clienti.utente_id), non dal campo Firestore Cliente_Ref:
// il bridge Postgres→Firestore preserva Cliente_Ref via round-trip fs_extra
// solo per i doc che lo avevano già PRIMA che il bridge entrasse in servizio
// (utenti importati da Flutter) — non lo calcola mai per account creati dopo
// (verificato: un UPDATE su core.clienti.utente_id viene processato dal
// bridge worker con successo, ma Cliente_Ref su Firestore resta null).

import type { Firestore } from "firebase-admin/firestore";
import { getDb } from "@/lib/db";

export interface ClienteAssegnato {
  uid: string;
  nome: string;
  clienteRefId: string | null;
}

export async function getClientiAssegnati(db: Firestore, repEmail: string): Promise<ClienteAssegnato[]> {
  const snap = await db.collection("users").where("Rappresentante", "==", repEmail).get();
  const base = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const nome = (data.display_name as string) || (data.Nome as string) || (data.email as string) || d.id;
    return { uid: d.id, nome };
  });
  if (base.length === 0) return [];

  const pg = getDb();
  const clienteRefIdByUid = new Map<string, string>();
  if (pg) {
    const uids = base.map((c) => c.uid);
    const { rows } = await pg.query(
      `SELECT id, utente_id FROM core.clienti WHERE utente_id = ANY($1)`,
      [uids]
    );
    for (const r of rows) clienteRefIdByUid.set(r.utente_id as string, r.id as string);
  }

  return base.map((c) => ({ ...c, clienteRefId: clienteRefIdByUid.get(c.uid) ?? null }));
}
