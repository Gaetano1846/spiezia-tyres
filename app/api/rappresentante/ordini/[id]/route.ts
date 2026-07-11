import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import { getClientiAssegnati } from "@/lib/rappresentanteDb";

export const runtime = "nodejs";

// GET /api/rappresentante/ordini/{id} → { ordine, cronologia }
//
// Dettaglio di UN ordine, autorizzato solo se appartiene a un cliente
// assegnato al rappresentante loggato (stessa verifica della lista, vedi
// route sorella ../route.ts). SERVER-SIDE via Admin SDK per lo stesso motivo:
// le Firestore Security Rules (Utente == richiedente || Admin || CRM) non
// riconoscono il legame rappresentante→cliente, quindi un rappresentante che
// legge l'ordine di un SUO cliente (piazzato dal cliente stesso, non da lui)
// otterrebbe sempre permission-denied lato client.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (session.Ruolo !== "Rappresentante" && session.Ruolo !== "Admin") {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const db = adminDb();
    const snap = await db.doc(`Ordini/${id}`).get();
    if (!snap.exists) return NextResponse.json({ error: "Ordine non trovato" }, { status: 404 });
    const data = snap.data() as Record<string, unknown>;

    if (session.Ruolo !== "Admin") {
      const clienti = await getClientiAssegnati(db, session.email);
      const clienteUids = new Set(clienti.map((c) => c.uid));
      const clienteRefIds = new Set(clienti.filter((c) => c.clienteRefId).map((c) => c.clienteRefId as string));
      const utenteId = (data.Utente as FirebaseFirestore.DocumentReference | undefined)?.id;
      const clienteId = (data.Cliente as FirebaseFirestore.DocumentReference | undefined)?.id;
      const autorizzato =
        (utenteId && clienteUids.has(utenteId)) || (clienteId && clienteRefIds.has(clienteId));
      if (!autorizzato) {
        return NextResponse.json({ error: "Non sei autorizzato a visualizzare questo ordine" }, { status: 403 });
      }
    }

    const cronSnap = await db.collection(`Ordini/${id}/Cronologia`).orderBy("Data", "asc").get();
    const cronologia = cronSnap.docs.map((d) => {
      const c = d.data() as Record<string, unknown>;
      const ts = c.Data as FirebaseFirestore.Timestamp | undefined;
      return { id: d.id, ...c, Data: ts?.toMillis?.() ?? null };
    });

    const dataTs = (data.DataCreazione ?? data.DataOra) as FirebaseFirestore.Timestamp | undefined;
    const ordine = {
      id: snap.id,
      ...data,
      Utente: (data.Utente as FirebaseFirestore.DocumentReference | undefined)?.id ?? null,
      Cliente: (data.Cliente as FirebaseFirestore.DocumentReference | undefined)?.id ?? null,
      DataCreazione: dataTs?.toMillis?.() ?? null,
      DataOra: undefined,
    };

    return NextResponse.json({ ordine, cronologia });
  } catch (err) {
    console.error("[api/rappresentante/ordini/id]", err);
    return NextResponse.json({ error: "Errore nel caricamento dell'ordine" }, { status: 500 });
  }
}
