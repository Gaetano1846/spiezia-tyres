"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from "recharts";
import {
  ShoppingBag, Euro, TrendingUp, Package, CalendarDays, AlertTriangle,
} from "lucide-react";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import AnchoredPopover from "@/components/ui/AnchoredPopover";
import CalendarRangePicker from "@/components/ui/CalendarRangePicker";
import MultiSearchableSelect from "@/components/ui/MultiSearchableSelect";

// Stessi valori/colori di admin/ordini/page.tsx — un ordine ha SEMPRE una di
// queste fonti sul campo Source (Tyre24, non T24 — vedi commento lì).
const FONTI = ["B2B", "eBay", "Amazon", "WooCommerce", "Tyre24", "Prezzo-Gomme", "AdTyres", "Anonimo", "Vetrina", "API"];
const FONTE_COLORS: Record<string, string> = {
  B2B: "#FFC803", eBay: "#92C821", Amazon: "#2196F3", WooCommerce: "#7F54B3",
  Tyre24: "#EC7522", "Prezzo-Gomme": "#1565C0", AdTyres: "#94A3B8", Anonimo: "#94A3B8",
  Vetrina: "#0F766E", API: "#475569", Altro: "#9CA3AF",
};

type BySource = { source: string; count: number; revenue: number; avgOrderValue: number };
type TimePoint = { date: string; count: number; revenue: number };
type TopProdotto = { label: string; quantita: number; fatturato: number };
type ReportData = {
  count: number;
  revenue: number;
  avgOrderValue: number;
  cancelledCount: number;
  bySource: BySource[];
  timeSeries: TimePoint[];
  topProdotti: TopProdotto[];
  truncated: boolean;
};

function getTodayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function getISODaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function formatISOToDisplay(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function formatEuro(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}
function formatDayShort(iso: string) {
  if (iso === "sconosciuto") return "?";
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export default function ReportPage() {
  const [dataDa, setDataDa] = useState(() => getISODaysAgo(30));
  const [dataA, setDataA] = useState(getTodayISO);
  const [fontiSelezionate, setFontiSelezionate] = useState<string[]>([]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const datePickerRef = useRef<HTMLDivElement>(null);

  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: dataDa, to: dataA });
      if (fontiSelezionate.length > 0) params.set("fonti", fontiSelezionate.join(","));
      const res = await fetch(`/api/admin/report?${params.toString()}`);
      const data = (await res.json().catch(() => ({}))) as ReportData & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Errore nel caricamento del report");
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore nel caricamento del report");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [dataDa, dataA, fontiSelezionate]);

  useEffect(() => { load(); }, [load]);

  const dateRangeLabel = dataDa === dataA
    ? formatISOToDisplay(dataDa)
    : `${formatISOToDisplay(dataDa)} - ${formatISOToDisplay(dataA)}`;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
            Report
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            Ordini, fatturato e prodotti più venduti per fonte e periodo
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Fonte (multi) */}
          <div className="min-w-[220px]">
            <MultiSearchableSelect
              values={fontiSelezionate}
              onChange={setFontiSelezionate}
              options={FONTI}
              placeholder="Tutte le fonti"
            />
          </div>

          {/* Date range */}
          <div className="relative" ref={datePickerRef}>
            <button
              onClick={() => setShowDatePicker((v) => !v)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm transition-colors hover:bg-[#f9fafb]"
              style={{ background: "#fff", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "#374151" }}
            >
              <CalendarDays size={14} style={{ color: "#6b7280" }} />
              {dateRangeLabel}
            </button>
            <AnchoredPopover
              open={showDatePicker}
              onClose={() => setShowDatePicker(false)}
              anchorRef={datePickerRef}
              width={320}
              align="right"
            >
              <CalendarRangePicker
                dataDa={dataDa}
                dataA={dataA}
                onChange={(da, a) => { setDataDa(da); setDataA(a); }}
              />
            </AnchoredPopover>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B" }}>
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {report?.truncated && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm" style={{ background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E" }}>
          <AlertTriangle size={15} /> Il periodo selezionato contiene molti ordini — il report potrebbe non includerli tutti. Restringi il periodo per un dato completo.
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 md:gap-4">
        <StatCard
          label="Ordini"
          value={loading ? "…" : (report?.count ?? 0)}
          sub={report && report.cancelledCount > 0 ? `+${report.cancelledCount} annullati/esclusi` : undefined}
          icon={<ShoppingBag size={22} />}
          accent="#FFC803"
        />
        <StatCard
          label="Fatturato"
          value={loading ? "…" : formatEuro(report?.revenue ?? 0)}
          icon={<Euro size={22} />}
          accent="#16A34A"
        />
        <StatCard
          label="Valore medio ordine"
          value={loading ? "…" : formatEuro(report?.avgOrderValue ?? 0)}
          icon={<TrendingUp size={22} />}
          accent="#6366F1"
        />
        <StatCard
          label="Fonti attive"
          value={loading ? "…" : (report?.bySource.length ?? 0)}
          sub={fontiSelezionate.length > 0 ? `${fontiSelezionate.length} selezionate` : "tutte"}
          icon={<Package size={22} />}
          accent="#EE8B60"
        />
      </div>

      {/* Andamento nel periodo */}
      <Card>
        <h2 className="text-base font-bold mb-4" style={{ fontFamily: "var(--font-poppins)" }}>
          Andamento — ordini e fatturato
        </h2>
        {loading ? (
          <div className="h-64 rounded-xl animate-pulse" style={{ background: "var(--bg-primary)" }} />
        ) : !report || report.timeSeries.length === 0 ? (
          <p className="text-sm py-12 text-center" style={{ color: "var(--text-muted)" }}>Nessun dato nel periodo selezionato.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={report.timeSeries} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tickFormatter={formatDayShort} tick={{ fontSize: 11, fontFamily: "var(--font-montserrat)" }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fontFamily: "var(--font-montserrat)" }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fontFamily: "var(--font-montserrat)" }} tickFormatter={(v) => formatEuro(v)} width={90} />
              <Tooltip
                formatter={(value, name) => [name === "Fatturato" ? formatEuro(Number(value)) : value, name]}
                labelFormatter={(l) => formatISOToDisplay(String(l))}
              />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="count" name="Ordini" stroke="#6366F1" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="revenue" name="Fatturato" stroke="#16A34A" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Fatturato per fonte */}
        <Card>
          <h2 className="text-base font-bold mb-4" style={{ fontFamily: "var(--font-poppins)" }}>
            Fatturato per fonte
          </h2>
          {loading ? (
            <div className="h-64 rounded-xl animate-pulse" style={{ background: "var(--bg-primary)" }} />
          ) : !report || report.bySource.length === 0 ? (
            <p className="text-sm py-12 text-center" style={{ color: "var(--text-muted)" }}>Nessun dato.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, report.bySource.length * 40)}>
              <BarChart data={report.bySource} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => formatEuro(v)} tick={{ fontSize: 11, fontFamily: "var(--font-montserrat)" }} />
                <YAxis type="category" dataKey="source" width={90} tick={{ fontSize: 12, fontFamily: "var(--font-montserrat)" }} />
                <Tooltip formatter={(value) => formatEuro(Number(value))} />
                <Bar dataKey="revenue" name="Fatturato" radius={[0, 6, 6, 0]}>
                  {report.bySource.map((s) => (
                    <Cell key={s.source} fill={FONTE_COLORS[s.source] ?? FONTE_COLORS.Altro} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Prodotti più venduti */}
        <Card>
          <h2 className="text-base font-bold mb-4" style={{ fontFamily: "var(--font-poppins)" }}>
            Prodotti più venduti (quantità)
          </h2>
          {loading ? (
            <div className="h-64 rounded-xl animate-pulse" style={{ background: "var(--bg-primary)" }} />
          ) : !report || report.topProdotti.length === 0 ? (
            <p className="text-sm py-12 text-center" style={{ color: "var(--text-muted)" }}>Nessun dato.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, Math.min(10, report.topProdotti.length) * 34)}>
              <BarChart data={report.topProdotti.slice(0, 10)} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fontFamily: "var(--font-montserrat)" }} allowDecimals={false} />
                <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 11, fontFamily: "var(--font-montserrat)" }} />
                <Tooltip formatter={(value, name) => [name === "Fatturato" ? formatEuro(Number(value)) : value, name]} />
                <Bar dataKey="quantita" name="Quantità" fill="#FFC803" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Tabella dettaglio per fonte */}
      <Card padding="none">
        <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <h2 className="text-base font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Dettaglio per fonte</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
            <thead>
              <tr className="text-left" style={{ borderBottom: "1px solid var(--border)" }}>
                {["Fonte", "Ordini", "Fatturato", "Valore medio"].map((h) => (
                  <th key={h} className="px-5 py-3 text-xs font-semibold uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={4} className="px-5 py-3.5">
                      <div className="h-4 rounded animate-pulse" style={{ background: "var(--border)" }} />
                    </td>
                  </tr>
                ))
              ) : !report || report.bySource.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-8 text-center" style={{ color: "var(--text-muted)" }}>Nessun ordine nel periodo.</td></tr>
              ) : (
                report.bySource.map((s) => (
                  <tr key={s.source}>
                    <td className="px-5 py-3.5">
                      <span
                        className="px-2.5 py-1 rounded-full text-xs font-semibold"
                        style={{ background: (FONTE_COLORS[s.source] ?? FONTE_COLORS.Altro) + "22", color: FONTE_COLORS[s.source] ?? FONTE_COLORS.Altro }}
                      >
                        {s.source}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">{s.count}</td>
                    <td className="px-5 py-3.5 font-semibold">{formatEuro(s.revenue)}</td>
                    <td className="px-5 py-3.5">{formatEuro(s.avgOrderValue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Tabella prodotti più venduti */}
      <Card padding="none">
        <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <h2 className="text-base font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Prodotti più venduti</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
            <thead>
              <tr className="text-left" style={{ borderBottom: "1px solid var(--border)" }}>
                {["Prodotto", "Quantità venduta", "Fatturato"].map((h) => (
                  <th key={h} className="px-5 py-3 text-xs font-semibold uppercase tracking-widest whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={3} className="px-5 py-3.5">
                      <div className="h-4 rounded animate-pulse" style={{ background: "var(--border)" }} />
                    </td>
                  </tr>
                ))
              ) : !report || report.topProdotti.length === 0 ? (
                <tr><td colSpan={3} className="px-5 py-8 text-center" style={{ color: "var(--text-muted)" }}>Nessun prodotto nel periodo.</td></tr>
              ) : (
                report.topProdotti.map((p) => (
                  <tr key={p.label}>
                    <td className="px-5 py-3.5 font-medium">{p.label}</td>
                    <td className="px-5 py-3.5">{p.quantita}</td>
                    <td className="px-5 py-3.5 font-semibold">{formatEuro(p.fatturato)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
