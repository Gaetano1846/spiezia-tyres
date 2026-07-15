import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientiAssegnati } from "@/lib/rappresentanteDb";
import { getCliente } from "@/lib/clientiDb";

export const runtime = "nodejs";

// GET /api/rappresentante/clienti → { clienti }
//
// Anagrafiche Clienti (Fido incluso) dei clienti assegnati al rappresentante
// loggato — usato dal picker "Seleziona cliente" del checkout ("ordina per
// conto di"), che prima cercava su TUTTA la collezione Clienti indipendentemente
// da chi fosse loggato. Sia l'anagrafica (getCliente) sia l'assegnazione
// cliente↔rappresentante (getClientiAssegnati) vengono ora da Postgres
// (core.clienti / core.utenti.fs_extra->>'Rappresentante').

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (session.Ruolo !== "Rappresentante" && session.Ruolo !== "Admin") {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  try {
    const assegnati = await getClientiAssegnati(session.email);
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
