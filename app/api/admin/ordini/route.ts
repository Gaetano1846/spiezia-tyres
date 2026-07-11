import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { listOrdini } from "@/lib/ordiniDb";

export const runtime = "nodejs";

// GET /api/admin/ordini?da=YYYY-MM-DD&a=YYYY-MM-DD  (lista per periodo)
//     /api/admin/ordini?q=termine                    (ricerca globale, ignora da/a —
//       mirror del comportamento Algolia precedente: cerca su TUTTI gli ordini)
//     /api/admin/ordini?clienteId=xxx                (ordini di un cliente — tab CRM)
//
// Sostituisce la query Firestore diretta (client SDK) di admin/ordini/page.tsx —
// core.ordini è già alimentato in tempo reale dal bridge, ClienteNome/UtenteNome
// arrivano pre-risolti via JOIN (niente più batchGetDocs lato client).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const da = searchParams.get("da");
  const a = searchParams.get("a");
  const q = searchParams.get("q");
  const clienteId = searchParams.get("clienteId");

  if (!q && !clienteId && (!da || !a)) {
    return NextResponse.json({ error: "Intervallo date, termine di ricerca o clienteId obbligatorio" }, { status: 400 });
  }

  try {
    const ordini = await listOrdini(
      clienteId ? { clienteId, limit: 50 }
      : q ? { q, limit: 500 }
      : { dataDa: `${da}T00:00:00`, dataA: `${a}T23:59:59.999`, limit: 2000 }
    );
    return NextResponse.json({ ordini });
  } catch (err) {
    console.error("[api/admin/ordini GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento ordini" }, { status: 500 });
  }
}
