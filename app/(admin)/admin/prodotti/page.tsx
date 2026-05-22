"use client";

import { useState, useEffect, useMemo } from "react";
import { Package, Search, Eye, Pencil, X, ChevronLeft, ChevronRight } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import StatCard from "@/components/ui/StatCard";
import toast from "react-hot-toast";
import {
  searchProdotti, stockTotale, formatMisura,
  type ProdottoHit,
} from "@/lib/algolia";

const PAGE_SIZE = 50;

function formatEuro(n: number | undefined | null) {
  return (n ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

const stagioneVariant: Record<string, "brand" | "neutral" | "success"> = {
  Estive: "brand",
  Invernali: "neutral",
  "4-Stagioni": "success",
};

export default function ProdottiPage() {
  const [tutti, setTutti] = useState<ProdottoHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [marca, setMarca] = useState("");
  const [stagione, setStagione] = useState("");
  const [soloDisponibili, setSoloDisponibili] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    searchProdotti({ query: "", soloDisponibili: false, hitsPerPage: 1000, page: 0 })
      .then((r) => setTutti(r.hits as ProdottoHit[]))
      .catch(() => toast.error("Errore nel caricamento prodotti"))
      .finally(() => setLoading(false));
  }, []);

  const marcheUniche = useMemo(
    () => [...new Set(tutti.map((p) => p.Marca).filter(Boolean))].sort(),
    [tutti]
  );

  const filtered = useMemo(() => {
    setPage(0);
    return tutti.filter((p) => {
      if (search) {
        const q = search.toLowerCase();
        if (![p.Marca, p.Modello, p.EAN ?? "", p.Titolo ?? ""].join(" ").toLowerCase().includes(q)) return false;
      }
      if (marca && p.Marca !== marca) return false;
      if (stagione && p.Stagione !== stagione) return false;
      if (soloDisponibili && stockTotale(p) === 0) return false;
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutti, search, marca, stagione, soloDisponibili]);

  const paginated = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page]
  );
  const nbPages = Math.ceil(filtered.length / PAGE_SIZE);

  const stats = useMemo(() => {
    const totale = tutti.length;
    const disponibili = tutti.filter((p) => stockTotale(p) > 0).length;
    const esauriti = tutti.filter((p) => stockTotale(p) === 0).length;
    return [
      { label: "Totale prodotti", value: totale,     sub: "in catalogo", icon: <Package size={20} />, accent: "#FFC803" },
      { label: "Disponibili",     value: disponibili, sub: "a magazzino", icon: <Package size={20} />, accent: "#249689" },
      { label: "Esauriti",        value: esauriti,    sub: "stock zero",  icon: <Package size={20} />, accent: "#FF5963" },
      { label: "In promozione",   value: 0,           sub: "scontati",    icon: <Package size={20} />, accent: "#EE8B60" },
    ];
  }, [tutti]);

  const hasFilters = !!(search || marca || stagione || soloDisponibili);

  function reset() {
    setSearch(""); setMarca(""); setStagione(""); setSoloDisponibili(false);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Prodotti</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "Caricamento…" : `${filtered.length} prodotti`}
          </p>
        </div>
        <button
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold hover:opacity-80 transition-opacity"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
        >
          + Aggiungi prodotto
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      <Card padding="sm">
        {/* Toolbar */}
        <div className="flex gap-2 mb-3 flex-wrap items-center">
          <div className="flex-1 min-w-48 relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per marca, modello, EAN…"
              className="w-full pl-9 pr-4 py-2 rounded-xl text-sm outline-none"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }}
            />
          </div>
          <select value={marca} onChange={(e) => setMarca(e.target.value)}
            className="px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
            <option value="">Tutte le marche</option>
            {marcheUniche.map((m) => <option key={m}>{m}</option>)}
          </select>
          <select value={stagione} onChange={(e) => setStagione(e.target.value)}
            className="px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
            <option value="">Tutte le stagioni</option>
            <option value="Estive">Estive</option>
            <option value="Invernali">Invernali</option>
            <option value="4-Stagioni">4 Stagioni</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer flex-shrink-0"
            style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
            <input type="checkbox" checked={soloDisponibili}
              onChange={(e) => setSoloDisponibili(e.target.checked)} className="rounded" />
            Solo disponibili
          </label>
          {hasFilters && (
            <button onClick={reset}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              <X size={13} />
            </button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                {["", "Marca / Modello", "Misura", "Stagione", "Stock totale", "P. Gommista", "P. Acquisto", ""].map((h, i) => (
                  <th key={i} className="pb-2.5 pr-3 text-left text-[10px] font-bold uppercase tracking-widest whitespace-nowrap"
                    style={{ color: "var(--text-muted)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="py-3 pr-3">
                        <div className="h-3.5 rounded animate-pulse"
                          style={{ background: "var(--border)", width: j === 0 ? "2.5rem" : "75%" }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                    Nessun prodotto trovato.
                  </td>
                </tr>
              ) : (
                paginated.map((p) => {
                  const ts = stockTotale(p);
                  return (
                    <tr key={p.objectID} className="border-t hover:bg-[#FFFDF0] transition-colors cursor-pointer"
                      style={{ borderColor: "var(--border)" }}>
                      {/* Immagine */}
                      <td className="py-2.5 pr-3">
                        {p.Immagine ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.Immagine} alt={p.Marca}
                            className="w-9 h-9 object-contain rounded-lg"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[9px] font-bold"
                            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                            IMG
                          </div>
                        )}
                      </td>
                      {/* Marca / Modello */}
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{p.Marca}</div>
                        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>{p.Modello}</div>
                      </td>
                      {/* Misura */}
                      <td className="py-2.5 pr-3 text-sm font-medium whitespace-nowrap"
                        style={{ color: "var(--text-primary)" }}>
                        {formatMisura(p)}
                      </td>
                      {/* Stagione */}
                      <td className="py-2.5 pr-3">
                        {p.Stagione
                          ? <Badge variant={stagioneVariant[p.Stagione] ?? "neutral"}>{p.Stagione}</Badge>
                          : <span style={{ color: "var(--text-muted)" }}>—</span>}
                      </td>
                      {/* Stock */}
                      <td className="py-2.5 pr-3 text-sm font-semibold"
                        style={{ color: ts === 0 ? "#EF4444" : "var(--text-primary)" }}>
                        {ts}
                      </td>
                      {/* P. Gommista */}
                      <td className="py-2.5 pr-3 text-sm font-semibold"
                        style={{ color: "var(--text-primary)" }}>
                        {formatEuro(p.Prezzo_Gommista)}
                      </td>
                      {/* P. Acquisto */}
                      <td className="py-2.5 pr-3 text-sm"
                        style={{ color: "var(--text-secondary)" }}>
                        {p.Prezzo_Acquisto != null ? formatEuro(p.Prezzo_Acquisto) : "—"}
                      </td>
                      {/* Azioni */}
                      <td className="py-2.5">
                        <div className="flex items-center gap-1.5">
                          <button className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            style={{ border: "1px solid var(--border)" }}>
                            <Eye size={13} style={{ color: "var(--text-secondary)" }} />
                          </button>
                          <button className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            style={{ border: "1px solid var(--border)" }}>
                            <Pencil size={13} style={{ color: "var(--text-secondary)" }} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {nbPages > 1 && (
          <div className="flex items-center justify-between mt-3 pt-3"
            style={{ borderTop: "1px solid var(--border)" }}>
            <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} di {filtered.length}
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1.5 rounded-lg disabled:opacity-30"
                style={{ border: "1px solid var(--border)", background: "var(--bg-primary)" }}>
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: Math.min(nbPages, 7) }).map((_, i) => {
                const half = 3;
                let start = Math.max(0, page - half);
                const end = Math.min(nbPages - 1, start + 6);
                start = Math.max(0, end - 6);
                const idx = start + i;
                if (idx >= nbPages) return null;
                const active = idx === page;
                return (
                  <button key={idx} onClick={() => setPage(idx)}
                    className="w-7 h-7 rounded-lg text-xs font-semibold"
                    style={{
                      background: active ? "var(--brand)" : "var(--bg-primary)",
                      border: `1px solid ${active ? "var(--brand)" : "var(--border)"}`,
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-montserrat)",
                    }}>
                    {idx + 1}
                  </button>
                );
              })}
              <button onClick={() => setPage((p) => Math.min(nbPages - 1, p + 1))} disabled={page >= nbPages - 1}
                className="p-1.5 rounded-lg disabled:opacity-30"
                style={{ border: "1px solid var(--border)", background: "var(--bg-primary)" }}>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
