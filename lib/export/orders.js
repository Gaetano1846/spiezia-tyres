// Export ordini CSV — port della custom action FlutterFlow `exportOrders`.
// Stessa struttura (12 colonne) e stessa logica: PFU e Prezzo_Acquisto vengono
// calcolati leggendo il prodotto referenziato da ogni articolo.
//
// Ordini: da core.ordini (Postgres, già allineato in tempo reale dal bridge)
// via listOrdiniForExport — Articoli aggregati in un'unica query invece di
// N+1 fetch per ordine. Prodotti (PFU/Prezzo_Acquisto): risolti in batch per
// SKU (Articoli[].Sku, già su Postgres) via getProdottiByIds — non serve più
// il RefPath Firestore, public.prodotti.id È lo SKU.

import { listOrdiniForExport } from "../ordiniDb";
import { getProdottiByIds } from "../prodottiDb";

const HEADER = [
  "DataOra", "ID", "Source", "Totale", "PFU", "IVA", "Pagamento.Nome",
  "Stato", "Articoli", "Prezzo_Acquisto", "Indirizzo_Fatturazione", "Indirizzo_Spedizione",
];

// Escape identico al FF: virgolette solo se il valore contiene , " o newline.
function esc(val) {
  let s = val === null || val === undefined ? "" : String(val);
  if (s === "null") s = "";
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Arrotonda a 2 decimali evitando errori di floating point (come formatNumber FF).
function fmtNum(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "number" ? v : parseFloat(v);
  if (Number.isNaN(n)) return "";
  return String(Math.round(n * 100) / 100);
}

// ISO → "yyyy-MM-dd HH:mm:ss".
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Indirizzo → "Destinatario, Via, Citta, Provincia, CAP, Paese, Telefono" (non vuoti).
function addr(a) {
  if (!a || typeof a !== "object") return "";
  return [a.Destinatario, a.Via, a.Citta, a.Provincia, a.CAP, a.Paese, a.Telefono]
    .filter((e) => e !== null && e !== undefined && String(e).length > 0)
    .join(", ");
}

export async function buildOrdersCsv(ordiniIds) {
  const orders = await listOrdiniForExport({ ids: ordiniIds, limit: ordiniIds.length });

  // Raccogli gli SKU prodotto unici da tutti gli articoli e caricali in batch.
  const skus = new Set();
  for (const o of orders) for (const a of o.Articoli) if (a.Sku) skus.add(a.Sku);
  const prodotti = await getProdottiByIds([...skus]);
  const prodBySku = new Map(prodotti.map((p) => [p.id, p]));

  const rows = [HEADER.join(",")];
  for (const o of orders) {
    // PFU e Prezzo_Acquisto sommati sugli articoli (logica identica al FF).
    let totalPFU = 0;
    let totalPrezzoAcquisto = 0;
    for (const a of o.Articoli) {
      const qty = a.Quantita || 0;
      let pfuValue = a.PFU || 0;
      if (a.Sku) {
        const prod = prodBySku.get(a.Sku);
        if (prod) {
          if (pfuValue === 0 && prod.PFU != null) pfuValue = Number(prod.PFU) || 0;
          if (prod.Prezzo_Acquisto != null) {
            totalPrezzoAcquisto += (Number(prod.Prezzo_Acquisto) || 0) * qty;
          }
        }
      }
      totalPFU += pfuValue * qty;
    }

    const articoliStr = o.Articoli
      .map((a) => `${a.Quantita ?? ""} x ${a.Titolo ?? ""} (${a.Sku ?? ""})`)
      .join(" | ");

    const row = [
      esc(fmtDate(o.Data)),
      esc(o.Numero ?? o.id ?? ""),
      esc(o.Source ?? ""),
      esc(fmtNum(o.Totale)),
      esc(fmtNum(totalPFU)),
      esc(fmtNum(o.IVA)),
      esc(o.Pagamento && o.Pagamento.Nome ? o.Pagamento.Nome : ""),
      esc(o.Stato ?? ""),
      esc(articoliStr),
      esc(fmtNum(totalPrezzoAcquisto)),
      esc(addr(o.IndirizzoFatturazione)),
      esc(addr(o.IndirizzoSpedizione)),
    ];
    rows.push(row.join(","));
  }

  return rows.join("\n");
}
