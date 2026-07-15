import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import { getClientiAssegnati } from "@/lib/rappresentanteDb";

export const runtime = "nodejs";

// GET /api/checkout/cliente/{id}/indirizzi → { indirizzi }
//
// Indirizzi di fatturazione salvati del cliente selezionato in "ordina per
// conto di" (checkout). Le Firestore Security Rules su
// Clienti/{id}/Indirizzo_FatturazioneC richiedono isAdmin() || isCRM() — un
// Rappresentante puro (senza il flag CRM) non soddisfa nessuna delle due,
// quindi la lettura diretta dal client falliva sempre con permission-denied
// (silenziosamente, il checkout continuava a funzionare ma senza mai
// mostrare il dropdown "Usa un indirizzo salvato del cliente"). SERVER-SIDE
// via Admin SDK, con autorizzazione: un Admin può leggere qualunque cliente,
// un Rappresentante solo i propri assegnati.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (session.Ruolo !== "Admin" && session.Ruolo !== "Rappresentante") {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const db = adminDb();

    if (session.Ruolo !== "Admin") {
      const assegnati = await getClientiAssegnati(session.email);
      const autorizzato = assegnati.some((c) => c.clienteRefId === id);
      if (!autorizzato) {
        return NextResponse.json({ error: "Non sei autorizzato a visualizzare questo cliente" }, { status: 403 });
      }
    }

    const snap = await db.collection(`Clienti/${id}/Indirizzo_FatturazioneC`).get();
    const indirizzi = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ indirizzi });
  } catch (err) {
    console.error("[api/checkout/cliente/indirizzi]", err);
    return NextResponse.json({ error: "Errore nel caricamento degli indirizzi" }, { status: 500 });
  }
}
