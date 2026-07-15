import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientiAssegnati } from "@/lib/rappresentanteDb";
import { getOrdine } from "@/lib/ordiniDb";

export const runtime = "nodejs";

// GET /api/rappresentante/ordini/{id} → { ordine }  (stessa forma OrdineApi
// di /api/ordini/[id] e /api/admin/ordini/[id] — Cronologia inclusa)
//
// Dettaglio di UN ordine, autorizzato solo se appartiene a un cliente
// assegnato al rappresentante loggato (stessa verifica della lista, vedi
// route sorella ../route.ts). L'autorizzazione va verificata a mano (niente
// Security Rules lato Postgres): un rappresentante che legge l'ordine di un
// SUO cliente (piazzato dal cliente stesso, non da lui) è autorizzato solo
// perché quel cliente è assegnato a lui, non perché ne è il proprietario.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (session.Ruolo !== "Rappresentante" && session.Ruolo !== "Admin") {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const ordine = await getOrdine(id);
    if (!ordine) return NextResponse.json({ error: "Ordine non trovato" }, { status: 404 });

    if (session.Ruolo !== "Admin") {
      const clienti = await getClientiAssegnati(session.email);
      const clienteUids = new Set(clienti.map((c) => c.uid));
      const clienteRefIds = new Set(clienti.filter((c) => c.clienteRefId).map((c) => c.clienteRefId as string));
      const autorizzato =
        (ordine.UtenteId && clienteUids.has(ordine.UtenteId)) ||
        (ordine.ClienteId && clienteRefIds.has(ordine.ClienteId));
      if (!autorizzato) {
        return NextResponse.json({ error: "Non sei autorizzato a visualizzare questo ordine" }, { status: 403 });
      }
    }

    return NextResponse.json({ ordine });
  } catch (err) {
    console.error("[api/rappresentante/ordini/id]", err);
    return NextResponse.json({ error: "Errore nel caricamento dell'ordine" }, { status: 500 });
  }
}
