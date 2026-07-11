import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export const runtime = "nodejs";

// GET /api/admin/report?from=YYYY-MM-DD&to=YYYY-MM-DD&fonti=B2B,eBay
//
// Report aggregato ordini (conteggio, fatturato, valore medio, andamento nel
// tempo, prodotti più venduti) per fonte e periodo. SERVER-SIDE via Admin SDK
// — Ordini può contenere migliaia di documenti, un'aggregazione di questa
// portata via client Firestore SDK sarebbe sia lenta sia soggetta alle stesse
// Security Rules problematiche viste altrove in questa sessione.
//
// Due difficoltà reali del modello dati, gestite qui:
//  1. Data: gli ordini scritti dal checkout B2B (app/api/checkout/ordine)
//     valorizzano DataCreazione; TUTTI gli importer legacy (Woo/eBay/AdTyres/
//     Tyre24) valorizzano invece DataOra. Query doppia (range su entrambi i
//     campi) + merge per id, altrimenti un range-query su un solo campo
//     escluderebbe silenziosamente metà degli ordini dal periodo.
//  2. Articoli: il formato differisce tra checkout B2B (Prodotto/PrezzoUnitario/
//     Marca+Titolo) e importer (Ref/Prezzo/Prezzo_Totale/Titolo, niente Marca).
//     Normalizzato in articoloKey/articoloLabel/articoloRigaTotale.

const CANCELLED_STATI = new Set(["Annullato", "Out of Stock", "Cancellato Tyre24", "Cancellato Cliente"]);
const MAX_DOCS_PER_QUERY = 5000;

interface RawArticolo {
  Prodotto?: string;
  Ref?: FirebaseFirestore.DocumentReference;
  Titolo?: string;
  Marca?: string;
  SKU?: string;
  Quantita?: number;
  PrezzoUnitario?: number;
  Prezzo?: number;
  Prezzo_Totale?: number;
}

function articoloKey(a: RawArticolo): string {
  if (a.Prodotto) return `p:${a.Prodotto}`;
  if (a.Ref) return `r:${a.Ref.id}`;
  if (a.SKU) return `s:${a.SKU}`;
  return `t:${a.Titolo ?? "sconosciuto"}`;
}

function articoloLabel(a: RawArticolo): string {
  if (a.Marca && a.Titolo) return `${a.Marca} ${a.Titolo}`;
  return a.Titolo || a.SKU || "Sconosciuto";
}

function articoloRigaTotale(a: RawArticolo): number {
  if (typeof a.Prezzo_Totale === "number") return a.Prezzo_Totale;
  const unit = typeof a.PrezzoUnitario === "number" ? a.PrezzoUnitario : (typeof a.Prezzo === "number" ? a.Prezzo : 0);
  const qty = typeof a.Quantita === "number" ? a.Quantita : 0;
  return unit * qty;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  const fontiParam = searchParams.get("fonti");

  if (!fromStr || !toStr) {
    return NextResponse.json({ error: "Parametri from/to obbligatori" }, { status: 400 });
  }
  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T23:59:59.999`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return NextResponse.json({ error: "Range date non valido" }, { status: 400 });
  }

  const fontiFiltro = fontiParam ? fontiParam.split(",").map((s) => s.trim()).filter(Boolean) : [];

  try {
    const db = adminDb();
    const fromTs = Timestamp.fromDate(from);
    const toTs = Timestamp.fromDate(to);

    const [snapDataOra, snapDataCreazione] = await Promise.all([
      db.collection("Ordini").where("DataOra", ">=", fromTs).where("DataOra", "<=", toTs).limit(MAX_DOCS_PER_QUERY).get(),
      db.collection("Ordini").where("DataCreazione", ">=", fromTs).where("DataCreazione", "<=", toTs).limit(MAX_DOCS_PER_QUERY).get(),
    ]);

    const byId = new Map<string, FirebaseFirestore.DocumentData>();
    for (const d of [...snapDataOra.docs, ...snapDataCreazione.docs]) {
      if (!byId.has(d.id)) byId.set(d.id, d.data());
    }
    const truncated = snapDataOra.size >= MAX_DOCS_PER_QUERY || snapDataCreazione.size >= MAX_DOCS_PER_QUERY;

    let docs = [...byId.values()];
    if (fontiFiltro.length > 0) {
      docs = docs.filter((d) => fontiFiltro.includes((d.Source as string) ?? ""));
    }

    // Il fatturato/conteggio "reale" esclude ordini annullati/out-of-stock/
    // cancellati — restano visibili a parte (cancelledCount) ma non inquinano
    // fatturato o valore medio ordine.
    const validi = docs.filter((d) => !CANCELLED_STATI.has((d.Stato as string) ?? ""));
    const cancellati = docs.filter((d) => CANCELLED_STATI.has((d.Stato as string) ?? ""));

    let totRevenue = 0;
    const bySourceMap = new Map<string, { count: number; revenue: number }>();
    // Andamento nel tempo: fatturato per FONTE per giorno (non un totale
    // globale) — una riga = un giorno, una colonna = una fonte. Il frontend
    // disegna una linea per fonte da questa forma "larga".
    const byDaySourceMap = new Map<string, Map<string, number>>();
    const prodMap = new Map<string, { label: string; quantita: number; fatturato: number }>();

    for (const d of validi) {
      const totale = Number(d.Totale ?? 0);
      totRevenue += totale;

      const source = (d.Source as string)?.trim() || "Altro";
      const bs = bySourceMap.get(source) ?? { count: 0, revenue: 0 };
      bs.count += 1;
      bs.revenue += totale;
      bySourceMap.set(source, bs);

      const ts = (d.DataOra ?? d.DataCreazione) as FirebaseFirestore.Timestamp | undefined;
      const day = ts?.toDate ? ts.toDate().toISOString().slice(0, 10) : "sconosciuto";
      const daySources = byDaySourceMap.get(day) ?? new Map<string, number>();
      daySources.set(source, (daySources.get(source) ?? 0) + totale);
      byDaySourceMap.set(day, daySources);

      const articoli = (d.Articoli as RawArticolo[] | undefined) ?? [];
      for (const a of articoli) {
        const key = articoloKey(a);
        const p = prodMap.get(key) ?? { label: articoloLabel(a), quantita: 0, fatturato: 0 };
        p.quantita += Number(a.Quantita ?? 0);
        p.fatturato += articoloRigaTotale(a);
        prodMap.set(key, p);
      }
    }

    const count = validi.length;
    const avgOrderValue = count > 0 ? totRevenue / count : 0;

    const bySource = [...bySourceMap.entries()]
      .map(([source, s]) => ({ source, count: s.count, revenue: s.revenue, avgOrderValue: s.count > 0 ? s.revenue / s.count : 0 }))
      .sort((a, b) => b.revenue - a.revenue);

    // Sorgenti presenti nel periodo (già ordinate per fatturato desc) — il
    // frontend le usa per sapere quante <Line> disegnare, senza dover
    // conoscere in anticipo l'elenco fonti.
    const sources = bySource.map((s) => s.source);

    const timeSeries = [...byDaySourceMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, daySources]) => {
        const row: Record<string, string | number> = { date };
        for (const source of sources) row[source] = daySources.get(source) ?? 0;
        return row;
      });

    const topProdotti = [...prodMap.values()]
      .sort((a, b) => b.quantita - a.quantita)
      .slice(0, 15);

    return NextResponse.json({
      count,
      revenue: totRevenue,
      avgOrderValue,
      cancelledCount: cancellati.length,
      bySource,
      sources,
      timeSeries,
      topProdotti,
      truncated,
    });
  } catch (err) {
    console.error("[api/admin/report]", err);
    return NextResponse.json({ error: "Errore nel calcolo del report" }, { status: 500 });
  }
}
