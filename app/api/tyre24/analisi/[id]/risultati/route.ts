import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { getSession, isAdmin } from "@/lib/auth";
import { getRisultati, getAllRisultati, getAnalisiJob, type AnalisiRisultatoApi } from "@/lib/tyre24/analisiDb";

export const runtime = "nodejs";

// GET /api/tyre24/analisi/[id]/risultati?livello2=&stato=&limit=&offset=
// — righe risultato paginate per la tabella a schermo, oppure
// ?format=csv per l'export rapido (stesso stile di
// app/api/admin/ordini/export/route.ts: delimitatore ";", BOM UTF-8,
// decimali con la virgola — leggibile in Excel italiano), oppure
// ?format=xlsx per il report completo (stesse colonne del tool desktop
// Python "Tyre24 Price Analyzer" originale, adattate al nuovo modello dati
// competitor-relative — vedi lib/tyre24/pricing.ts).

const DELIM = ";";

function esc(val: unknown): string {
  const s = val == null ? "" : String(val);
  if (s.includes(DELIM) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function eur(n: number | null): string {
  return n == null ? "" : n.toFixed(2).replace(".", ",");
}

function toCsv(rows: AnalisiRisultatoApi[]): string {
  const header = [
    "SKU", "EAN", "CAI", "Titolo", "Marca", "Stagione",
    "Prezzo Acquisto (DB)", "Prezzo Attuale (mercato)", "Ek Stimato", "Ek Verificato", "Livello2",
    "Distributore", "Stock Distributore", "PAV", "Prezzo Suggerito", "Stato", "Note",
  ];
  const lines = [header.map(esc).join(DELIM)];
  for (const r of rows) {
    lines.push([
      r.sku, r.ean, r.cai, r.titolo, r.marca, r.stagione,
      eur(r.prezzoAcquistoDb), eur(r.prezzoAttualeMercato), eur(r.ekStimato), eur(r.ekVerificato), r.livello2 ? "SI" : "NO",
      r.distributorNome, r.distributorStock ?? "", eur(r.pav), eur(r.prezzoSuggerito), r.stato, r.note,
    ].map(esc).join(DELIM));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// Colonne XLSX — stesso spirito del tool Python originale, adattate al
// modello competitor-relative (nostra posizione + 2° classificato). Le
// differenze sono derivate qui a export-time, non salvate in DB (funzioni
// pure delle colonne già persistite). "Proiezione profitto" usa stockT24
// (stock interno del prodotto), NON nostroStock (quello è lo stock che
// Tyre24 riporta per il nostro listing) — due grandezze diverse, come nel
// tool Python originale.
function diff(a: number | null, b: number | null): number | null {
  return a != null && b != null ? Math.round((a - b) * 100) / 100 : null;
}

function toXlsxRows(rows: AnalisiRisultatoApi[]): (string | number | null)[][] {
  const header = [
    "SKU", "CAI", "EAN", "Titolo", "Marca", "Stagione",
    "Prezzo Attuale (mercato)", "Livello", "Nostra Posizione", "Nostro Stock",
    "1° Classificato", "Prezzo 1°", "Stock 1°", "Differenza col 1°",
    "2° Classificato", "Prezzo 2°", "Stock 2°", "Differenza col 2°",
    "Prezzo Suggerito", "Differenza attuale/suggerito",
    "ACQ", "PAV", "Differenza suggerito/PAV", "Proiezione Profitto", "Stato", "Note",
  ];
  const lines: (string | number | null)[][] = [header];
  for (const r of rows) {
    const diffSuggeritoPav = diff(r.prezzoSuggerito, r.pav);
    const proiezioneProfitto = diffSuggeritoPav != null
      ? Math.round(r.stockT24 * diffSuggeritoPav * 100) / 100
      : null;
    lines.push([
      r.sku, r.cai, r.ean, r.titolo, r.marca, r.stagione,
      r.prezzoAttualeMercato,
      r.livello2 ? "2 (verificato)" : "1 (stimato)",
      r.livello2 ? (r.nostraPos ?? "ASSENTI") : "",
      r.nostroStock,
      r.distributorNome, r.ekVerificato, r.distributorStock, diff(r.prezzoAttualeMercato, r.ekVerificato),
      r.secondNome, r.secondPrezzo, r.secondStock, diff(r.prezzoAttualeMercato, r.secondPrezzo),
      r.prezzoSuggerito, diff(r.prezzoSuggerito, r.prezzoAttualeMercato),
      r.prezzoAcquistoDb, r.pav, diffSuggeritoPav, proiezioneProfitto,
      r.stato, r.note,
    ]);
  }
  return lines;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  const { searchParams } = new URL(req.url);

  try {
    if (searchParams.get("format") === "csv") {
      const livello2Param = searchParams.get("livello2");
      const rows = await getAllRisultati(id, {
        livello2: livello2Param != null ? livello2Param === "true" : undefined,
        stato: searchParams.get("stato") ?? undefined,
      });
      const csv = toCsv(rows);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="tyre24-analisi-${id}.csv"`,
        },
      });
    }

    if (searchParams.get("format") === "xlsx") {
      const livello2Param = searchParams.get("livello2");
      const [rows, job] = await Promise.all([
        getAllRisultati(id, {
          livello2: livello2Param != null ? livello2Param === "true" : undefined,
          stato: searchParams.get("stato") ?? undefined,
        }),
        getAnalisiJob(id),
      ]);
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(toXlsxRows(rows));
      XLSX.utils.book_append_sheet(wb, ws, "Analisi Tyre24");
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
      const nomeMercato = job?.Paese ?? id;
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="tyre24-analisi-${nomeMercato}-${id}.xlsx"`,
        },
      });
    }

    const livello2Param = searchParams.get("livello2");
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");
    const { rows, hasMore } = await getRisultati(id, {
      livello2: livello2Param != null ? livello2Param === "true" : undefined,
      stato: searchParams.get("stato") ?? undefined,
      limit: limitParam ? Number(limitParam) : undefined,
      offset: offsetParam ? Number(offsetParam) : undefined,
    });
    return NextResponse.json({ rows, hasMore });
  } catch (err) {
    console.error("[api/tyre24/analisi/[id]/risultati GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento risultati" }, { status: 500 });
  }
}
