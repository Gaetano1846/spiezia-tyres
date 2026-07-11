import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import { getClientiAssegnati } from "@/lib/rappresentanteDb";

export const runtime = "nodejs";

// GET /api/rappresentante/ordini → { ordini, clienti }
//
// Ordini di TUTTI i clienti assegnati al rappresentante loggato — non solo
// quelli che il rappresentante ha piazzato lui stesso ("ordina per conto di",
// Ordini.Utente == rappresentante), ma anche quelli che il cliente ha
// piazzato autonomamente (Ordini.Utente == cliente). Il collegamento
// cliente→rappresentante vive su users/{uid}.Rappresentante (email del
// rappresentante, assegnato da admin/clienti). SERVER-SIDE via Admin SDK per
// lo stesso motivo di tutte le altre route Ordini di questa sessione: le
// Firestore Security Rules richiedono un token Firebase Auth live che con
// l'auth VPS-native non è garantito lato client.

const CHUNK = 30; // limite Firestore per l'operatore 'in'

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (session.Ruolo !== "Rappresentante" && session.Ruolo !== "Admin") {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  try {
    const db = adminDb();

    // 1. Clienti assegnati a questo rappresentante (users.Rappresentante == mia email).
    const clienti = await getClientiAssegnati(db, session.email);

    if (clienti.length === 0) {
      return NextResponse.json({ ordini: [], clienti: [] });
    }

    // Mappe di risoluzione: id doc Cliente → {uid, nome} del cliente assegnato.
    const clienteRefIdToUid = new Map(
      clienti.filter((c) => c.clienteRefId).map((c) => [c.clienteRefId as string, c.uid])
    );
    const uidToNome = new Map(clienti.map((c) => [c.uid, c.nome]));

    const userRefs = clienti.map((c) => db.doc(`users/${c.uid}`));
    const clienteRefs = clienti
      .filter((c) => c.clienteRefId)
      .map((c) => db.doc(`Clienti/${c.clienteRefId}`));

    // 2. Ordini piazzati direttamente dai clienti (Utente == loro uid).
    const ordiniById = new Map<string, Record<string, unknown>>();
    for (const batch of chunk(userRefs, CHUNK)) {
      const snap = await db.collection("Ordini").where("Utente", "in", batch).get();
      for (const doc of snap.docs) {
        const data = doc.data();
        const utenteId = (data.Utente as FirebaseFirestore.DocumentReference)?.id;
        ordiniById.set(doc.id, { id: doc.id, ...data, _repClienteUid: utenteId });
      }
    }

    // 3. Ordini piazzati per loro conto da staff (Cliente == la loro anagrafica).
    for (const batch of chunk(clienteRefs, CHUNK)) {
      if (batch.length === 0) continue;
      const snap = await db.collection("Ordini").where("Cliente", "in", batch).get();
      for (const doc of snap.docs) {
        if (ordiniById.has(doc.id)) continue; // già incluso via Utente
        const data = doc.data();
        const clienteId = (data.Cliente as FirebaseFirestore.DocumentReference)?.id;
        const repClienteUid = clienteId ? clienteRefIdToUid.get(clienteId) : undefined;
        ordiniById.set(doc.id, { id: doc.id, ...data, _repClienteUid: repClienteUid ?? null });
      }
    }

    const ordini = [...ordiniById.values()]
      .map((o) => {
        const ts = (o.DataCreazione ?? o.DataOra) as FirebaseFirestore.Timestamp | undefined;
        const sortMillis = ts?.toMillis?.() ?? 0;
        return {
          ...o,
          _repClienteNome: o._repClienteUid ? uidToNome.get(o._repClienteUid as string) ?? null : null,
          // I riferimenti Firestore non sono serializzabili in JSON — solo id.
          Utente: (o.Utente as FirebaseFirestore.DocumentReference | undefined)?.id ?? null,
          Cliente: (o.Cliente as FirebaseFirestore.DocumentReference | undefined)?.id ?? null,
          DataCreazione: sortMillis || null,
          DataOra: undefined,
          _sortMillis: sortMillis,
        };
      })
      .sort((a, b) => b._sortMillis - a._sortMillis)
      .map(({ _sortMillis, ...rest }) => rest);

    return NextResponse.json({
      ordini,
      clienti: clienti.map((c) => ({ uid: c.uid, nome: c.nome })),
    });
  } catch (err) {
    console.error("[api/rappresentante/ordini]", err);
    return NextResponse.json({ error: "Errore nel caricamento degli ordini" }, { status: 500 });
  }
}
