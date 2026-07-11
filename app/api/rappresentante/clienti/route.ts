import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import { getClientiAssegnati } from "@/lib/rappresentanteDb";

export const runtime = "nodejs";

// GET /api/rappresentante/clienti → { clienti }
//
// Anagrafiche Clienti (Fido incluso) dei clienti assegnati al rappresentante
// loggato — usato dal picker "Seleziona cliente" del checkout ("ordina per
// conto di"), che prima cercava su TUTTA la collezione Clienti indipendentemente
// da chi fosse loggato. SERVER-SIDE via Admin SDK: solo i clienti con un
// Cliente_Ref collegato hanno senso qui (serve l'anagrafica Clienti per
// creare l'ordine, non basta l'account di login).

function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "id" in v && "path" in v) {
      out[k] = (v as FirebaseFirestore.DocumentReference).id;
    } else if (v && typeof v === "object" && typeof (v as FirebaseFirestore.Timestamp).toMillis === "function") {
      out[k] = (v as FirebaseFirestore.Timestamp).toMillis();
    } else {
      out[k] = v;
    }
  }
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
    const assegnati = await getClientiAssegnati(db, session.email);
    const clienteRefIds = assegnati.filter((c) => c.clienteRefId).map((c) => c.clienteRefId as string);

    if (clienteRefIds.length === 0) {
      return NextResponse.json({ clienti: [] });
    }

    const snaps = await Promise.all(clienteRefIds.map((id) => db.doc(`Clienti/${id}`).get()));
    const clienti = snaps
      .filter((s) => s.exists)
      .map((s) => ({ id: s.id, ...sanitize(s.data() as Record<string, unknown>) }));

    return NextResponse.json({ clienti });
  } catch (err) {
    console.error("[api/rappresentante/clienti]", err);
    return NextResponse.json({ error: "Errore nel caricamento dei clienti" }, { status: 500 });
  }
}
