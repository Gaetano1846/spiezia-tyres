import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { renameModelloProdotti } from "@/lib/prodottiDb";

export const runtime = "nodejs";

// POST /api/admin/disegni/rinomina-prodotti { oldNome, nome } — cascata
// Postgres della rinomina disegno (chiamata da admin/disegni ACCANTO alla
// rinomina del doc Firestore Modello, che resta invariata — Modello non è
// parte del catalogo Prodotti, nessun equivalente Postgres). Ritorna il
// conteggio righe per il toast admin ("N prodotti aggiornati"). Nota:
// Meilisearch (indice condiviso, alimentato dall'import Prezzo-Gomme)
// riflette il nuovo nome solo al prossimo giro di import orario — Postgres è
// corretto da subito.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  let body: { oldNome?: unknown; nome?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const { oldNome, nome } = body;
  if (typeof oldNome !== "string" || !oldNome.trim() || typeof nome !== "string" || !nome.trim()) {
    return NextResponse.json({ error: "oldNome e nome sono richiesti" }, { status: 400 });
  }

  try {
    const count = await renameModelloProdotti(oldNome, nome);
    return NextResponse.json({ count });
  } catch (err) {
    console.error("[api/admin/disegni/rinomina-prodotti]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}
