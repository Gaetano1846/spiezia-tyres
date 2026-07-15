import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import { getClientiAssegnati } from "@/lib/rappresentanteDb";
import { getCliente } from "@/lib/clientiDb";

export const runtime = "nodejs";

// GET /api/rappresentante/clienti → { clienti }
//
// Anagrafiche Clienti (Fido incluso) dei clienti assegnati al rappresentante
// loggato — usato dal picker "Seleziona cliente" del checkout ("ordina per
// conto di"), che prima cercava su TUTTA la collezione Clienti indipendentemente
// da chi fosse loggato. L'anagrafica ora viene da core.clienti (getCliente,
// fonte autoritativa dalla Fase 3) — resta su Firestore solo l'assegnazione
// cliente↔rappresentante (getClientiAssegnati, users.Rappresentante),
// dominio non ancora migrato.

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

    const clienti = (await Promise.all(clienteRefIds.map(getCliente))).filter(Boolean);

    return NextResponse.json({ clienti });
  } catch (err) {
    console.error("[api/rappresentante/clienti]", err);
    return NextResponse.json({ error: "Errore nel caricamento dei clienti" }, { status: 500 });
  }
}
