import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { listIndirizziCliente } from "@/lib/clientiDb";
import { getClientiAssegnati } from "@/lib/rappresentanteDb";

export const runtime = "nodejs";

// GET /api/checkout/cliente/{id}/indirizzi → { indirizzi }
//
// Indirizzi di fatturazione salvati del cliente selezionato in "ordina per
// conto di" (checkout) — core.clienti_indirizzi (decommissioning finale
// Firebase, sostituisce Clienti/{id}/Indirizzo_FatturazioneC, già bridgeata
// bidirezionalmente). SERVER-SIDE con autorizzazione: un Admin può leggere
// qualunque cliente, un Rappresentante solo i propri assegnati.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (session.Ruolo !== "Admin" && session.Ruolo !== "Rappresentante") {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;

  try {
    if (session.Ruolo !== "Admin") {
      const assegnati = await getClientiAssegnati(session.email);
      const autorizzato = assegnati.some((c) => c.clienteRefId === id);
      if (!autorizzato) {
        return NextResponse.json({ error: "Non sei autorizzato a visualizzare questo cliente" }, { status: 403 });
      }
    }

    const indirizzi = await listIndirizziCliente(id, "fatturazione");
    return NextResponse.json({ indirizzi });
  } catch (err) {
    console.error("[api/checkout/cliente/indirizzi]", err);
    return NextResponse.json({ error: "Errore nel caricamento degli indirizzi" }, { status: 500 });
  }
}
