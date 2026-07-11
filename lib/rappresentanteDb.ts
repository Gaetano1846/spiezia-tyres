// Risoluzione "clienti assegnati a un rappresentante" — condivisa dalle route
// /api/rappresentante/ordini (lista) e /api/rappresentante/ordini/[id]
// (dettaglio + controllo autorizzazione). Il collegamento vive su
// users/{uid}.Rappresentante (email del rappresentante, assegnato da
// admin/clienti), non su Postgres — il dominio Ordini/Clienti resta
// Firestore-nativo per questa fase della migrazione.

import type { Firestore } from "firebase-admin/firestore";

export interface ClienteAssegnato {
  uid: string;
  nome: string;
  clienteRefId: string | null;
}

export async function getClientiAssegnati(db: Firestore, repEmail: string): Promise<ClienteAssegnato[]> {
  const snap = await db.collection("users").where("Rappresentante", "==", repEmail).get();
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const nome = (data.display_name as string) || (data.Nome as string) || (data.email as string) || d.id;
    const clienteRef = data.Cliente_Ref;
    const clienteRefId =
      clienteRef && typeof clienteRef === "object" && "id" in clienteRef
        ? (clienteRef as { id: string }).id
        : null;
    return { uid: d.id, nome, clienteRefId };
  });
}
