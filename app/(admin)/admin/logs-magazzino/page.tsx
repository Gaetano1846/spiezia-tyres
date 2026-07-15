"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { ArrowDownCircle, ArrowUpCircle, Warehouse, Users, Search, RefreshCw, X, ChevronDown, SlidersHorizontal, CalendarDays } from "lucide-react";
import StatCard from "@/components/ui/StatCard";
import CalendarRangePicker from "@/components/ui/CalendarRangePicker";
import AnchoredPopover from "@/components/ui/AnchoredPopover";
import toast from "react-hot-toast";
import type { LogMagazzinoApi } from "@/lib/logsMagazzinoDb";
import type { SimpleEntity } from "@/lib/lookupDb";

// Pagina di sola lettura sull'audit trail movimenti magazzino (b2b.logs_magazzino),
// scritto dall'app Flutter ad ogni "Approva"/rimozione pneumatico. Filtri data/
// azione/sede lato server (paginati con "Carica altri"); ricerca testuale
// client-side sulle righe già caricate, stesso pattern della pagina Spedizioni.

const PAGE_SIZE = 50;

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("it-IT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatISOToDisplay(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function RowSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i}>
          <td colSpan={7} className="py-1 px-2">
            <div className="h-12 rounded-xl animate-pulse" style={{ background: "#f3f4f6" }} />
          </td>
        </tr>
      ))}
    </>
  );
}

// Selettore intervallo date (da–a): trigger + calendario in popover ancorato.
// Stessa UX della pagina Spedizioni (CalendarRangePicker + AnchoredPopover).
function DateRangeField({
  dataDa, dataA, onChange,
}: {
  dataDa: string;
  dataA: string;
  onChange: (da: string, a: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const label = dataDa === dataA
    ? formatISOToDisplay(dataDa)
    : `${formatISOToDisplay(dataDa)} – ${formatISOToDisplay(dataA)}`;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors hover:bg-white"
        style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}
      >
        <CalendarDays size={14} style={{ color: "#6b7280" }} />
        {label}
      </button>
      <AnchoredPopover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={320} align="right">
        <CalendarRangePicker dataDa={dataDa} dataA={dataA} onChange={onChange} />
      </AnchoredPopover>
    </div>
  );
}

export default function LogsMagazzinoPage() {
  const [rows, setRows] = useState<LogMagazzinoApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const [search, setSearch] = useState("");
  const [dataDa, setDataDa] = useState(todayStr());
  const [dataA, setDataA] = useState(todayStr());
  const [azione, setAzione] = useState(""); // "" | "Ha aggiunto" | "Ha rimosso"
  const [sedeId, setSedeId] = useState("");
  const [sediOptions, setSediOptions] = useState<SimpleEntity[]>([]);

  useEffect(() => {
    fetch("/api/lookup/sede")
      .then((r) => r.json())
      .then(({ items }) => setSediOptions(items ?? []))
      .catch(() => {});
  }, []);

  const buildUrl = useCallback((offset: number) => {
    const params = new URLSearchParams({ dataDa, dataA, limit: String(PAGE_SIZE), offset: String(offset) });
    if (azione) params.set("azione", azione);
    if (sedeId) params.set("sedeId", sedeId);
    return `/api/logs-magazzino?${params.toString()}`;
  }, [dataDa, dataA, azione, sedeId]);

  // Ricarica da zero quando cambiano i filtri lato server (data/azione/sede).
  useEffect(() => {
    setLoading(true);
    fetch(buildUrl(0))
      .then((r) => r.json())
      .then(({ logs, hasMore: more }) => {
        setRows(logs ?? []);
        setHasMore(!!more);
      })
      .catch((err) => {
        console.error(err);
        toast.error("Errore nel caricamento dei log magazzino");
      })
      .finally(() => setLoading(false));
  }, [buildUrl]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await fetch(buildUrl(rows.length));
      const { logs, hasMore: more } = await res.json();
      setRows((prev) => [...prev, ...(logs ?? [])]);
      setHasMore(!!more);
    } catch (err) {
      console.error(err);
      toast.error("Errore nel caricamento");
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      [r.ProdottoLabel, r.GabbiaCodice, r.UtenteNome, r.Motivo, r.SedeNome].some((v) => v?.toLowerCase().includes(q))
    );
  }, [rows, search]);

  const stats = useMemo(() => {
    const entrate = rows.filter((r) => r.Azione === "Ha aggiunto").length;
    const uscite = rows.filter((r) => r.Azione === "Ha rimosso").length;
    const operatori = new Set(rows.map((r) => r.UtenteNome).filter(Boolean)).size;
    return [
      { label: "Movimenti", value: `${rows.length}${hasMore ? "+" : ""}`, sub: "nel periodo",           icon: <Warehouse className="w-4 h-4 md:w-[22px] md:h-[22px]" />,     accent: "#FFC803" },
      { label: "Entrate",   value: entrate,                               sub: "pneumatici aggiunti",   icon: <ArrowDownCircle className="w-4 h-4 md:w-[22px] md:h-[22px]" />, accent: "#10B981" },
      { label: "Uscite",    value: uscite,                                sub: "pneumatici rimossi",    icon: <ArrowUpCircle className="w-4 h-4 md:w-[22px] md:h-[22px]" />,   accent: "#F43F5E" },
      { label: "Operatori", value: operatori,                             sub: "attivi nel periodo",    icon: <Users className="w-4 h-4 md:w-[22px] md:h-[22px]" />,          accent: "#2563EB" },
    ];
  }, [rows, hasMore]);

  const today = todayStr();
  const isDefaultRange = dataDa === today && dataA === today;
  const hasActiveFilters = !!(search || azione || sedeId || !isDefaultRange);

  function reset() {
    setSearch(""); setDataDa(todayStr()); setDataA(todayStr()); setAzione(""); setSedeId("");
  }

  return (
    <div className="space-y-2.5 md:space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Log Magazzino</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
          {loading ? "Caricamento…" : `${filtered.length} movimenti${hasMore ? " · altri disponibili" : ""}`}
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 md:gap-4">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub} icon={s.icon} accent={s.accent} />
        ))}
      </div>

      {/* Toolbar */}
      <div className="space-y-2">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-[150px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per prodotto, gabbia, operatore, motivo…"
              className="w-full pl-9 pr-4 py-2 rounded-xl text-sm outline-none"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }} />
          </div>

          {/* Desktop: Azione + Sede + Data + Reset a destra */}
          <div className="hidden md:flex items-center gap-2 ml-auto">
            <select value={azione} onChange={(e) => setAzione(e.target.value)}
              className="px-3 py-2 rounded-xl text-sm outline-none cursor-pointer"
              style={{ background: azione ? "#FFF8DC" : "var(--bg-primary)", border: `1px solid ${azione ? "#FFC803" : "var(--border)"}`, fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
              <option value="">Tutti i movimenti</option>
              <option value="Ha aggiunto">Entrate</option>
              <option value="Ha rimosso">Uscite</option>
            </select>
            <select value={sedeId} onChange={(e) => setSedeId(e.target.value)}
              className="px-3 py-2 rounded-xl text-sm outline-none cursor-pointer"
              style={{ background: sedeId ? "#FFF8DC" : "var(--bg-primary)", border: `1px solid ${sedeId ? "#FFC803" : "var(--border)"}`, fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
              <option value="">Tutte le sedi</option>
              {sediOptions.map((s) => <option key={s.id} value={s.id}>{s.Nome}</option>)}
            </select>
            <DateRangeField dataDa={dataDa} dataA={dataA} onChange={(da, a) => { setDataDa(da); setDataA(a); }} />
            {hasActiveFilters && (
              <button onClick={reset}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-colors hover:bg-white"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
                <RefreshCw size={13} /> Reset
              </button>
            )}
          </div>

          {/* Mobile: toggle Filtri + reset */}
          <button onClick={() => setShowFilters((v) => !v)}
            className="md:hidden flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold flex-shrink-0 transition-colors"
            style={{ background: showFilters ? "#FFC803" : "var(--bg-primary)", border: "1px solid var(--border)", color: "#111", fontFamily: "var(--font-montserrat)" }}>
            <SlidersHorizontal size={14} /> Filtri
            {(() => { const n = [azione, sedeId, !isDefaultRange].filter(Boolean).length; return n > 0 ? (
              <span className="w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: "#111", color: "#FFC803" }}>{n}</span>
            ) : null; })()}
            <ChevronDown size={14} style={{ transform: showFilters ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </button>
          {hasActiveFilters && (
            <button onClick={reset}
              className="md:hidden flex items-center gap-1 px-3 py-2 rounded-xl text-sm flex-shrink-0"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              <X size={13} />
            </button>
          )}
        </div>

        {/* Mobile: pannello filtri collassabile */}
        <div className={`${showFilters ? "flex" : "hidden"} md:hidden gap-2 flex-wrap items-center`}>
          <select value={azione} onChange={(e) => setAzione(e.target.value)}
            className="px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
            <option value="">Tutti i movimenti</option>
            <option value="Ha aggiunto">Entrate</option>
            <option value="Ha rimosso">Uscite</option>
          </select>
          <select value={sedeId} onChange={(e) => setSedeId(e.target.value)}
            className="px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
            <option value="">Tutte le sedi</option>
            {sediOptions.map((s) => <option key={s.id} value={s.id}>{s.Nome}</option>)}
          </select>
          <DateRangeField dataDa={dataDa} dataA={dataA} onChange={(da, a) => { setDataDa(da); setDataA(a); }} />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid var(--border)" }}>
        <div className="overflow-x-auto hidden md:block">
          <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)", minWidth: 1000 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid var(--border)" }}>
                {["Data/Ora", "Movimento", "Prodotto", "Gabbia", "Operatore", "Sede", "Motivo"].map((h) => (
                  <th key={h} className="py-2.5 px-3 text-left whitespace-nowrap">
                    <span className="inline-block px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider"
                      style={{ background: "#eceef1", color: "#4b5563", fontFamily: "var(--font-montserrat)" }}>
                      {h}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <RowSkeleton />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                    Nessun movimento trovato.
                  </td>
                </tr>
              ) : (
                filtered.map((r, idx) => {
                  const isEntrata = r.Azione === "Ha aggiunto";
                  const rowBg = idx % 2 === 0 ? "#fff" : "#fafafa";
                  return (
                    <tr key={r.id} style={{ background: rowBg, borderBottom: "1px solid #f3f4f6" }}>
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{formatDateTime(r.Data)}</span>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap"
                          style={{ background: isEntrata ? "#ECFDF5" : "#FFF1F2", color: isEntrata ? "#047857" : "#BE123C" }}>
                          {isEntrata ? <ArrowDownCircle size={12} /> : <ArrowUpCircle size={12} />}
                          {isEntrata ? "+" : "-"}{r.Quantita}
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="text-sm" style={{ color: "var(--text-primary)" }}>{r.ProdottoLabel ?? "—"}</span>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="text-xs font-mono font-semibold" style={{ color: "var(--text-primary)" }}>{r.GabbiaCodice ?? "—"}</span>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="text-xs" style={{ color: "var(--text-primary)" }}>{r.UtenteNome ?? "—"}</span>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{r.SedeNome ?? "—"}</span>
                      </td>
                      <td className="py-3.5 px-3 max-w-[220px]">
                        <span className="text-xs truncate block" style={{ color: "var(--text-secondary)" }} title={r.Motivo ?? undefined}>{r.Motivo ?? "—"}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Card — mobile */}
        <div className="md:hidden">
          {loading ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "#f3f4f6" }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-14 text-center text-sm" style={{ color: "var(--text-muted)" }}>Nessun movimento trovato.</div>
          ) : (
            filtered.map((r) => {
              const isEntrata = r.Azione === "Ha aggiunto";
              return (
                <div key={r.id} className="p-3" style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold flex-shrink-0"
                      style={{ background: isEntrata ? "#ECFDF5" : "#FFF1F2", color: isEntrata ? "#047857" : "#BE123C" }}>
                      {isEntrata ? <ArrowDownCircle size={11} /> : <ArrowUpCircle size={11} />}
                      {isEntrata ? "+" : "-"}{r.Quantita}
                    </span>
                    <span className="text-xs flex-1 min-w-0 truncate" style={{ color: "var(--text-primary)" }}>{r.ProdottoLabel ?? "—"}</span>
                    <span className="text-[11px] flex-shrink-0" style={{ color: "var(--text-muted)" }}>{formatDateTime(r.Data)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] flex-wrap" style={{ color: "var(--text-secondary)" }}>
                    <span>Gabbia {r.GabbiaCodice ?? "—"}</span>
                    <span>·</span>
                    <span>{r.UtenteNome ?? "—"}</span>
                    <span>·</span>
                    <span>{r.SedeNome ?? "—"}</span>
                  </div>
                  {r.Motivo && (
                    <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>{r.Motivo}</p>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Carica altri */}
        {hasMore && !loading && (
          <div className="p-3 flex justify-center" style={{ borderTop: "1px solid var(--border)" }}>
            <button onClick={loadMore} disabled={loadingMore}
              className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
              {loadingMore ? "Caricamento…" : "Carica altri"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
