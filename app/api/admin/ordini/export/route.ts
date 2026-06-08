import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { getSession, isAdmin } from "@/lib/auth";
import type { Timestamp, DocumentReference } from "firebase-admin/firestore";

// ─── Export CSV ordini ───────────────────────────────────────────────────────
// Stessi dati del vecchio export Flutter, ma formattati per una lettura pulita in
// Excel/WPS italiano: delimitatore ";", decimali con la virgola, BOM UTF-8,
// data in formato italiano, intestazioni leggibili e colonne riordinate
// (categorie + importi a sinistra, testi lunghi a destra).

const DELIM = ";";

// DataOra → "dd/MM/yyyy HH:mm:ss" in fuso Europe/Rome (formato italiano, Excel lo riconosce come data).
function fmtDataOra(ts: Timestamp | null | undefined): string {
  const d = ts?.toDate?.();
  if (!d) return "";
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(d).reduce<Record<string, string>>((a, x) => { a[x.type] = x.value; return a; }, {});
  const hh = p.hour === "24" ? "00" : p.hour;
  return `${p.day}/${p.month}/${p.year} ${hh}:${p.minute}:${p.second}`;
}

function toNum(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Importo → 2 decimali con la virgola (es. 328.6 → "328,60"), senza separatore delle migliaia
// così Excel italiano lo interpreta come numero.
function eur(value: unknown): string {
  return toNum(value).toFixed(2).replace(".", ",");
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

type Articolo = {
  Ref?: DocumentReference;
  Titolo?: string;
  SKU?: string;
  Quantita?: number;
  PFU?: number;
};
type Indirizzo = {
  Destinatario?: string; Via?: string; Citta?: string;
  Provincia?: string; CAP?: string; Paese?: string; Telefono?: string;
};

// Indirizzo → "Destinatario, Via, Citta, Provincia, CAP, Paese, Telefono" (parti non vuote).
function fmtIndirizzo(ind: Indirizzo | undefined): string {
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
    // Ordina per DataOra (campo reale degli ordini; "DataCreazione" non esiste → export vuoto).
    const snap = await adminDb().collection("Ordini").orderBy("DataOra", "desc").limit(2000).get();

    // PFU e Prezzo_Acquisto vanno letti dai documenti Prodotto referenziati dagli articoli.
    // Raccogliamo i Ref unici e li risolviamo in batch (getAll) per evitare N+1.
    const prodRefByPath = new Map<string, DocumentReference>();
    for (const d of snap.docs) {
      const articoli = (d.data().Articoli ?? []) as Articolo[];
      for (const a of articoli) {
        if (a?.Ref?.path && !prodRefByPath.has(a.Ref.path)) prodRefByPath.set(a.Ref.path, a.Ref);
      }
    }
    const prodByPath = new Map<string, { PFU: number; Prezzo_Acquisto: number }>();
    const allRefs = [...prodRefByPath.values()];
    for (let i = 0; i < allRefs.length; i += 300) {
      const chunk = allRefs.slice(i, i + 300);
      if (chunk.length === 0) continue;
      const resolved = await adminDb().getAll(...chunk);
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

    for (const d of snap.docs) {
      const o = d.data();
      const articoli = (o.Articoli ?? []) as Articolo[];

      // PFU totale (da articolo, o dal prodotto se l'articolo ha PFU 0) e Prezzo_Acquisto totale.
      let totalPFU = 0;
      let totalPrezzoAcquisto = 0;
      for (const a of articoli) {
        const qty = toNum(a?.Quantita);
        let pfuValue = toNum(a?.PFU);
        const path = a?.Ref?.path;
        if (path && prodByPath.has(path)) {
          const p = prodByPath.get(path)!;
          if (pfuValue === 0) pfuValue = p.PFU;
          totalPrezzoAcquisto += p.Prezzo_Acquisto * qty;
        }
        totalPFU += pfuValue * qty;
      }

      // Articoli → "qty x Titolo (SKU)" separati da " | ".
      const articoliStr = articoli
        .map((a) => `${toNum(a?.Quantita)} x ${a?.Titolo ?? ""} (${a?.SKU ?? ""})`)
        .join(" | ");

      const pagamento = (o.Pagamento ?? {}) as { Nome?: string };

      const row = [
        fmtDataOra(o.DataOra as Timestamp),
        o.ID ?? d.id,
        o.Source ?? "",
        o.Stato ?? "",
        pagamento.Nome ?? "",
        eur(o.Totale),
        eur(o.IVA),
        eur(totalPFU),
        eur(totalPrezzoAcquisto),
        articoliStr,
        fmtIndirizzo(o.Indirizzo_Fatturazione as Indirizzo),
        fmtIndirizzo(o.Indirizzo_Spedizione as Indirizzo),
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
