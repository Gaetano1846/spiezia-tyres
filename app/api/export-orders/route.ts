import { NextResponse } from "next/server";
import { buildOrdersCsv } from "@/lib/export/orders";
import { getSession, isAdmin } from "@/lib/auth";

// Export CSV degli ordini selezionati — port della custom action FF `exportOrders`.
// Server-side perché calcola PFU/Prezzo_Acquisto leggendo i Prodotti referenziati.
// Protetto da sessione admin (l'export include il prezzo d'acquisto, dato sensibile).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  let body: { ordiniIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = Array.isArray(body.ordiniIds) ? body.ordiniIds.filter((x): x is string => typeof x === "string") : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "Nessun ordine da esportare" }, { status: 400 });
  }

  try {
    const csv = await buildOrdersCsv(ids);
    return new NextResponse(csv, {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Errore export" }, { status: 500 });
  }
}
