import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientiAssegnati } from "@/lib/rappresentanteDb";
import { listOrdini } from "@/lib/ordiniDb";

export const runtime = "nodejs";

// GET /api/rappresentante/ordini → { ordini, clienti }
//
// Ordini di TUTTI i clienti assegnati al rappresentante loggato — non solo
// quelli che il rappresentante ha piazzato lui stesso ("ordina per conto di",
// utente_id == rappresentante), ma anche quelli che il cliente ha piazzato
// autonomamente (utente_id == cliente) O quelli piazzati da staff per suo
// conto (cliente_id == la sua anagrafica). Il collegamento cliente→
// rappresentante vive su core.utenti.fs_extra->>'Rappresentante', risolto da
// getClientiAssegnati (Postgres).
//
// core.ordini è già allineato in tempo reale dal bridge: una singola query
// Postgres con utente_id/cliente_id = ANY($1) sostituisce le due query
// Firestore "in" chunked a 30 (nessun limite di dimensione batch da gestire).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (session.Ruolo !== "Rappresentante" && session.Ruolo !== "Admin") {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  try {
    const clienti = await getClientiAssegnati(session.email);
    if (clienti.length === 0) return NextResponse.json({ ordini: [], clienti: [] });

    const uidToNome = new Map(clienti.map((c) => [c.uid, c.nome]));
    const clienteRefIdToUid = new Map(
      clienti.filter((c) => c.clienteRefId).map((c) => [c.clienteRefId as string, c.uid])
    );

    const utenteIds = clienti.map((c) => c.uid);
    const clienteIds = clienti.filter((c) => c.clienteRefId).map((c) => c.clienteRefId as string);

    const rows = await listOrdini({ utenteIds, clienteIds, limit: 2000 });

    const ordini = rows.map((o) => {
      const repClienteUid = o.UtenteId && uidToNome.has(o.UtenteId)
        ? o.UtenteId
        : (o.ClienteId ? clienteRefIdToUid.get(o.ClienteId) ?? null : null);
      return {
        ...o,
        RepClienteUid: repClienteUid,
        RepClienteNome: repClienteUid ? uidToNome.get(repClienteUid) ?? null : null,
      };
    });

    return NextResponse.json({
      ordini,
      clienti: clienti.map((c) => ({ uid: c.uid, nome: c.nome })),
    });
  } catch (err) {
    console.error("[api/rappresentante/ordini]", err);
    return NextResponse.json({ error: "Errore nel caricamento degli ordini" }, { status: 500 });
  }
}
