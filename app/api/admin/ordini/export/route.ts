import { NextResponse } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { listOrdiniForExport } from "@/lib/ordiniDb";
import { adminDb } from "@/lib/firebase-admin";
import type { DocumentReference } from "firebase-admin/firestore";

// ─── Export CSV ordini ───────────────────────────────────────────────────────
// Stessi dati del vecchio export Flutter, ma formattati per una lettura pulita in
// Excel/WPS italiano: delimitatore ";", decimali con la virgola, BOM UTF-8,
// data in formato italiano, intestazioni leggibili e colonne riordinate
// (categorie + importi a sinistra, testi lunghi a destra).
//
// Ordini: da core.ordini (Postgres, già allineato in tempo reale dal bridge)
// via listOrdiniForExport — Articoli aggregati in una singola query invece
// che N+1. Prodotti (PFU/Prezzo_Acquisto) restano su Firestore, fuori scope
// di questa migrazione: risolti in batch dai ref_path degli articoli.

const DELIM = ";";

function toNum(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Importo → 2 decimali con la virgola (es. 328.6 → "328,60"), senza separatore delle migliaia
// così Excel italiano lo interpreta come numero.
function eur(value: unknown): string {
  return toNum(value).toFixed(2).replace(".", ",");
}

// ISO → "dd/MM/yyyy HH:mm:ss" in fuso Europe/Rome (formato italiano, Excel lo riconosce come data).
function fmtDataOra(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(d).reduce<Record<string, string>>((a, x) => { a[x.type] = x.value; return a; }, {});
  const hh = p.hour === "24" ? "00" : p.hour;
  return `${p.day}/${p.month}/${p.year} ${hh}:${p.minute}:${p.second}`;
}

// Escape CSV: quota solo se il valore contiene il delimitatore, doppice o a-capo; "null" → vuoto.
function esc(val: unknown): string {
  let s = val == null ? "" : String(val);
  if (s === "null") s = "";
  if (s.includes(DELIM) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

type Indirizzo = {
  Destinatario?: string; Via?: string; Citta?: string;
  Provincia?: string; CAP?: string; Paese?: string; Telefono?: string;
};

// Indirizzo → "Destinatario, Via, Citta, Provincia, CAP, Paese, Telefono" (parti non vuote).
function fmtIndirizzo(ind: Indirizzo | null | undefined): string {
  if (!ind) return "";
  return [ind.Destinatario, ind.Via, ind.Citta, ind.Provincia, ind.CAP, ind.Paese, ind.Telefono]
    .map((x) => (x == null ? "" : String(x)))
    .filter((x) => x.length > 0)
    .join(", ");
}

export async function GET() {
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  try {
    const ordini = await listOrdiniForExport({ limit: 2000 });

    // PFU e Prezzo_Acquisto vanno letti dai documenti Prodotto referenziati dagli
    // articoli (Prodotti resta su Firestore) — raccogliamo i ref_path unici e li
    // risolviamo in batch (getAll) per evitare N+1.
    const db = adminDb();
    const refPaths = new Set<string>();
    for (const o of ordini) for (const a of o.Articoli) if (a.RefPath) refPaths.add(a.RefPath);
    const prodByPath = new Map<string, { PFU: number; Prezzo_Acquisto: number }>();
    const allPaths = [...refPaths];
    for (let i = 0; i < allPaths.length; i += 300) {
      const chunk = allPaths.slice(i, i + 300).map((p) => db.doc(p) as DocumentReference);
      if (chunk.length === 0) continue;
      const resolved = await db.getAll(...chunk);
      for (const ps of resolved) {
        if (!ps.exists) continue;
        const pd = ps.data() ?? {};
        prodByPath.set(ps.ref.path, { PFU: toNum(pd.PFU), Prezzo_Acquisto: toNum(pd.Prezzo_Acquisto) });
      }
    }

    // Intestazioni leggibili; colonne riordinate per scansione rapida.
    const header = [
      "Data e Ora", "ID Ordine", "Canale", "Stato", "Pagamento",
      "Totale €", "IVA €", "PFU €", "Prezzo Acquisto €",
      "Articoli", "Indirizzo Fatturazione", "Indirizzo Spedizione",
    ];
    const lines: string[] = [header.map(esc).join(DELIM)];

    for (const o of ordini) {
      // PFU totale (da articolo, o dal prodotto se l'articolo ha PFU 0) e Prezzo_Acquisto totale.
      let totalPFU = 0;
      let totalPrezzoAcquisto = 0;
      for (const a of o.Articoli) {
        const qty = a.Quantita;
        let pfuValue = toNum(a.PFU);
        if (a.RefPath && prodByPath.has(a.RefPath)) {
          const p = prodByPath.get(a.RefPath)!;
          if (pfuValue === 0) pfuValue = p.PFU;
          totalPrezzoAcquisto += p.Prezzo_Acquisto * qty;
        }
        totalPFU += pfuValue * qty;
      }

      // Articoli → "qty x Titolo (SKU)" separati da " | ".
      const articoliStr = o.Articoli
        .map((a) => `${a.Quantita} x ${a.Titolo ?? ""} (${a.Sku ?? ""})`)
        .join(" | ");

      const row = [
        fmtDataOra(o.Data),
        o.Numero ?? o.id,
        o.Source,
        o.Stato,
        o.Pagamento?.Nome ?? "",
        eur(o.Totale),
        eur(o.IVA),
        eur(totalPFU),
        eur(totalPrezzoAcquisto),
        articoliStr,
        fmtIndirizzo(o.IndirizzoFatturazione),
        fmtIndirizzo(o.IndirizzoSpedizione),
      ].map(esc).join(DELIM);

      lines.push(row);
    }

    // BOM UTF-8 (accenti corretti in Excel) + righe terminate da CRLF (standard per Excel).
    const csv = "﻿" + lines.join("\r\n") + "\r\n";
    const filename = `ordini_${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Errore export CSV" }, { status: 500 });
  }
}
