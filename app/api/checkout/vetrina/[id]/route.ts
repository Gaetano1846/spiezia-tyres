import { NextResponse } from "next/server";
import { getOrdine } from "@/lib/ordiniDb";

// Lettura pubblica, filtrata, dell'ordine appena creato — usata dalla pagina
// di conferma Vetrina (thank_you_widget.dart) al posto del vecchio
// StreamBuilder<OrdiniRecord> su Firestore. Espone SOLO i campi mostrati in
// quella pagina (numero, totale, data/sede appuntamento, articoli con
// refPath per il lookup immagine prodotto su Firestore Prodotti — catalogo
// separato, non toccato da questa migrazione) — mai indirizzi/email/cliente,
// dato che l'endpoint non richiede autenticazione (l'id ordine nell'URL è
// l'unica "credenziale", stessa esposizione minima di un link di conferma
// e-commerce qualsiasi).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ordine = await getOrdine(id);
  if (!ordine || ordine.Source !== "Vetrina") {
    return NextResponse.json({ error: "Ordine non trovato" }, { status: 404 });
  }

  const fsExtra = (ordine as { FsExtra?: Record<string, unknown> }).FsExtra ?? {};

  return NextResponse.json({
    numero: ordine.Numero,
    totale: ordine.Totale,
    dataPrenotazione: (fsExtra.DataPrenotazione as string | null) ?? null,
    sedeAppuntamento: (fsExtra.SedeAppuntamento as string | null) ?? null,
    articoli: ordine.Articoli.map((a) => ({
      titolo: a.Titolo,
      quantita: a.Quantita,
      prezzo: a.PrezzoUnitario,
      refPath: a.RefPath,
    })),
  });
}
