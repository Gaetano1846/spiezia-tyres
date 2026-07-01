// Export ordini CSV — port della custom action FlutterFlow `exportOrders`.
// Stessa struttura (12 colonne) e stessa logica: PFU e Prezzo_Acquisto vengono
// calcolati leggendo il prodotto referenziato da ogni articolo (Articoli[].Ref).
// Gira server-side (firebase-admin) perché richiede letture dei Prodotti e i
// dati grezzi degli articoli (Ref/SKU) non sono nel tipo client.

import { adminDb } from "../firebase-admin";

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

// DataOra: Timestamp Firestore → "yyyy-MM-dd HH:mm:ss". Fallback come getTs client.
function fmtDate(o) {
  const ts = o.DataOra ?? o.dataOra ?? o.data_ora ?? o.DataCreazione ?? o.createdAt ?? o.created_time;
  const d = ts && ts.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
  if (!d) return "";
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
  const firestore = adminDb();

  // Leggi gli ordini richiesti (mantieni l'ordine di selezione).
  const orderSnaps = await Promise.all(
    ordiniIds.map((id) => firestore.collection("Ordini").doc(id).get())
  );
  const orders = orderSnaps.filter((s) => s.exists);

  // Raccogli i ref prodotto unici da tutti gli articoli e caricali in batch (getAll).
  const refByPath = new Map();
  for (const s of orders) {
    for (const art of s.data().Articoli || []) {
      if (art && art.Ref && art.Ref.path) refByPath.set(art.Ref.path, art.Ref);
    }
  }
  const prodByPath = new Map();
  const refs = [...refByPath.values()];
  if (refs.length > 0) {
    const prodSnaps = await firestore.getAll(...refs);
    for (const p of prodSnaps) if (p.exists) prodByPath.set(p.ref.path, p.data());
  }

  const rows = [HEADER.join(",")];
  for (const s of orders) {
    const o = s.data();
    const articoli = o.Articoli || [];

    // PFU e Prezzo_Acquisto sommati sugli articoli (logica identica al FF).
    let totalPFU = 0;
    let totalPrezzoAcquisto = 0;
    for (const art of articoli) {
      const qty = art.Quantita || 0;
      let pfuValue = art.PFU || 0;
      if (art && art.Ref && art.Ref.path) {
        const prod = prodByPath.get(art.Ref.path);
        if (prod) {
          if (pfuValue === 0 && prod.PFU != null) pfuValue = Number(prod.PFU) || 0;
          if (prod.Prezzo_Acquisto != null) {
            totalPrezzoAcquisto += (Number(prod.Prezzo_Acquisto) || 0) * qty;
          }
        }
      }
      totalPFU += pfuValue * qty;
    }

    const articoliStr = articoli
      .map((it) => `${it.Quantita ?? ""} x ${it.Titolo ?? ""} (${it.SKU ?? ""})`)
      .join(" | ");

    const row = [
      esc(fmtDate(o)),
      esc(o.ID ?? ""),
      esc(o.Source ?? ""),
      esc(fmtNum(o.Totale)),
      esc(fmtNum(totalPFU)),
      esc(fmtNum(o.IVA)),
      esc(o.Pagamento && o.Pagamento.Nome ? o.Pagamento.Nome : ""),
      esc(o.Stato ?? ""),
      esc(articoliStr),
      esc(fmtNum(totalPrezzoAcquisto)),
      esc(addr(o.Indirizzo_Fatturazione)),
      esc(addr(o.Indirizzo_Spedizione)),
    ];
    rows.push(row.join(","));
  }

  return rows.join("\n");
}
