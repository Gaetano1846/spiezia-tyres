"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Play, Download, TrendingUp, Search, Layers, AlertTriangle, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import StatCard from "@/components/ui/StatCard";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { AnalisiJobApi, AnalisiRisultatoApi, MonitoringKpi, CallsTimeSeriesPoint } from "@/lib/tyre24/analisiDb";

// Pagina admin per l'analisi prezzi Tyre24 sui prodotti REALMENTE nostri
// (public.prodotti WHERE t24=false — t24=true è il catalogo esterno Tyre24
// mirrorato per riferimento, 152k righe, non prodotti nostri) — sostituisce
// il tool desktop Python "Tyre24 Price Analyzer". Solo report: calcola
// prezzi suggeriti, non scrive mai su public.prodotti (l'utente applica
// manualmente dopo revisione).
// Strategia a 2 livelli, competitor-relative (rifinita 2026-07-21): /search
// sempre (economico, prezzo di vendita per il mercato scelto come
// riferimento); /distributorList (a pagamento) solo se siamo già noi i più
// economici, per capire se possiamo alzare il prezzo restando sotto il 2°
// classificato — vedi lib/tyre24/pricing.ts::needsLevel2. Tab Monitoraggio
// mostra il volume di chiamate nel tempo, tab Storico le analisi passate.

const MARKETS: { label: string; paese: string; lingua: string }[] = [
  { label: "Italia (IT)", paese: "it", lingua: "it" },
  { label: "Germania (DE)", paese: "de", lingua: "de" },
  { label: "Austria (AT)", paese: "at", lingua: "de" },
  { label: "Spagna (ES)", paese: "es", lingua: "es" },
  { label: "Francia (FR)", paese: "fr", lingua: "fr" },
  { label: "BeNeLux (BE)", paese: "be", lingua: "nl" },
  { label: "Polonia (PL)", paese: "pl", lingua: "pl" },
];

const PAGE_SIZE = 50;
const LAST_JOB_KEY = "tyre24_prezzi_last_job_id";

function fieldStyle() {
  return {
    background: "var(--bg-primary)", border: "1px solid var(--border)",
    fontFamily: "var(--font-montserrat)", color: "var(--text-primary)",
  } as const;
}

function eur(n: number | null): string {
  return n == null ? "—" : `€ ${n.toFixed(2)}`;
}

function formatDayShort(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export default function Tyre24PrezziPage() {
  const [tab, setTab] = useState<"analisi" | "storico" | "monitoraggio">("analisi");

  // ── Parametri form ──────────────────────────────────────────────────────
  const [marketIdx, setMarketIdx] = useState(0);
  const [marca, setMarca] = useState(""); // "" = tutte le marche
  const [marche, setMarche] = useState<string[]>([]);
  const [minStock, setMinStock] = useState(4);
  const [sogliaDeltaPct, setSogliaDeltaPct] = useState(5); // %, convertito in frazione all'invio
  const [margineFisso, setMargineFisso] = useState(6);
  const [spedizione, setSpedizione] = useState(4);
  const [commissionePct, setCommissionePct] = useState(1.5); // %
  const [pricingAdvantage, setPricingAdvantage] = useState(0.1);
  const [limitTest, setLimitTest] = useState<string>("");

  // ── Storico ──────────────────────────────────────────────────────────────
  const [storico, setStorico] = useState<AnalisiJobApi[]>([]);
  const [loadingStorico, setLoadingStorico] = useState(false);
  const [hasMoreStorico, setHasMoreStorico] = useState(false);

  // ── Job in corso ─────────────────────────────────────────────────────────
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<AnalisiJobApi | null>(null);
  const [starting, setStarting] = useState(false);

  // ── Risultati ────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<AnalisiRisultatoApi[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [hasMoreRows, setHasMoreRows] = useState(false);
  const [filterLivello2, setFilterLivello2] = useState<"" | "true" | "false">("");
  // Default "ok" — molti prodotti non hanno match su Tyre24 (EAN non
  // riconosciuto o articolo non presente sul marketplace): nascosti di
  // default dal report perché non c'è alcun confronto da mostrare per loro,
  // recuperabili scegliendo "Tutti" o "Solo non trovati" dal filtro.
  const [filterStato, setFilterStato] = useState<"" | "ok" | "no_match" | "errore">("ok");

  // ── Monitoraggio ─────────────────────────────────────────────────────────
  const [kpi, setKpi] = useState<MonitoringKpi | null>(null);
  const [serie, setSerie] = useState<CallsTimeSeriesPoint[]>([]);
  const [loadingMonitor, setLoadingMonitor] = useState(false);

  const notifiedDoneRef = useRef(false);

  // Ripristina l'ultimo job al (ri)caricamento della pagina — senza questo,
  // navigare via e tornare indietro fa perdere la vista su un'analisi ancora
  // in corso sul server (il job continua a girare comunque, è solo la UI a
  // "dimenticarlo"). localStorage è solo un fast-path per QUESTO browser —
  // aprire la pagina da un browser/sessione diversi (altro computer, finestra
  // anonima, cache pulita) lo trova vuoto anche se un job sta girando
  // davvero: per quello, se non c'è nulla in locale, si chiede al server.
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(LAST_JOB_KEY) : null;
    if (saved) {
      setJobId(saved);
      return;
    }
    fetch("/api/tyre24/analisi/latest")
      .then((r) => r.json())
      .then((data: { job?: AnalisiJobApi | null }) => {
        if (data.job) {
          setJobId(data.job.id);
          localStorage.setItem(LAST_JOB_KEY, data.job.id);
        }
      })
      .catch(() => {});
  }, []);

  // Popola il dropdown marca dal catalogo reale (niente lista hardcoded).
  useEffect(() => {
    fetch("/api/tyre24/marche")
      .then((r) => r.json())
      .then((data: { marche?: string[] }) => setMarche(data.marche ?? []))
      .catch(() => {});
  }, []);

  async function avviaAnalisi() {
    setStarting(true);
    notifiedDoneRef.current = false;
    setRows([]);
    setJob(null);
    try {
      const m = MARKETS[marketIdx];
      const res = await fetch("/api/tyre24/analisi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paese: m.paese, lingua: m.lingua, marca, minStock,
          sogliaDeltaPct: sogliaDeltaPct / 100, margineFisso, spedizione,
          commissionePct: commissionePct / 100, pricingAdvantage,
          limit: limitTest ? Number(limitTest) : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Errore avvio analisi");
      }
      const data = await res.json();
      setJobId(data.jobId);
      localStorage.setItem(LAST_JOB_KEY, data.jobId);
      toast.success(`Analisi avviata su ${data.totale} prodotti`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore avvio analisi");
    } finally {
      setStarting(false);
    }
  }

  // Polling stato job ogni 1.5s (stesso pattern di SpedizioniJobsWidget —
  // nessuna infra WebSocket/SSE in questo repo). Mentre il job è ancora in
  // corso, ricarica anche i risultati ogni ~7.5s (1 tick su 5) cosí non si
  // vede la tabella vuota fino alla fine — utile anche quando si torna sulla
  // pagina a metà di un job già avviato (vedi ripristino da localStorage sopra).
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let tick = 0;

    async function pollOnce() {
      try {
        const res = await fetch(`/api/tyre24/analisi/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setJob(data.job as AnalisiJobApi);
        if (data.job?.Stato !== "running" && !notifiedDoneRef.current) {
          notifiedDoneRef.current = true;
          if (data.job?.Stato === "error") toast.error(`Analisi fallita: ${data.job.Error ?? "errore sconosciuto"}`);
          else toast.success(`Analisi completata — ${data.job.ConVariazione} prodotti con variazione suggerita`);
          loadRisultati(0, true);
        } else if (data.job?.Stato === "running" && tick % 5 === 0) {
          loadRisultati(0, true);
        }
        tick++;
      } catch {
        // rete instabile — riprova al prossimo tick
      }
    }

    pollOnce();
    const interval = setInterval(pollOnce, 1500);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const loadRisultati = useCallback(async (offset: number, replace: boolean) => {
    if (!jobId) return;
    setLoadingRows(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (filterLivello2) params.set("livello2", filterLivello2);
      if (filterStato) params.set("stato", filterStato);
      const res = await fetch(`/api/tyre24/analisi/${jobId}/risultati?${params.toString()}`);
      const data = await res.json();
      setRows((prev) => (replace ? data.rows ?? [] : [...prev, ...(data.rows ?? [])]));
      setHasMoreRows(!!data.hasMore);
    } catch {
      toast.error("Errore nel caricamento risultati");
    } finally {
      setLoadingRows(false);
    }
  }, [jobId, filterLivello2, filterStato]);

  useEffect(() => {
    if (jobId && job) loadRisultati(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterLivello2, filterStato]);

  const loadMonitor = useCallback(async () => {
    setLoadingMonitor(true);
    try {
      const res = await fetch("/api/tyre24/monitoraggio");
      const data = await res.json();
      setKpi(data.kpi ?? null);
      setSerie(data.serie ?? []);
    } catch {
      toast.error("Errore nel caricamento monitoraggio");
    } finally {
      setLoadingMonitor(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "monitoraggio") loadMonitor();
  }, [tab, loadMonitor]);

  const loadStorico = useCallback(async (offset: number, replace: boolean) => {
    setLoadingStorico(true);
    try {
      const res = await fetch(`/api/tyre24/analisi?limit=${PAGE_SIZE}&offset=${offset}`);
      const data = await res.json();
      setStorico((prev) => (replace ? data.jobs ?? [] : [...prev, ...(data.jobs ?? [])]));
      setHasMoreStorico(!!data.hasMore);
    } catch {
      toast.error("Errore nel caricamento dello storico");
    } finally {
      setLoadingStorico(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "storico") loadStorico(0, true);
  }, [tab, loadStorico]);

  function apriJobDaStorico(id: string) {
    setJobId(id);
    localStorage.setItem(LAST_JOB_KEY, id);
    setTab("analisi");
  }

  const progress = job && job.Totale > 0 ? job.Processati / job.Totale : 0;

  return (
    <div className="space-y-2.5 md:space-y-5">
      <div>
        <h1 className="text-xl md:text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Prezzi Tyre24</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
          Analisi prezzi di acquisto per i prodotti nostri (esclude il catalogo esterno T24) — report da rivedere manualmente, nessuna scrittura automatica sul catalogo.
        </p>
      </div>

      {/* Sub-tab locali */}
      <div className="flex gap-2">
        {(["analisi", "storico", "monitoraggio"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-2 rounded-xl text-sm font-semibold capitalize transition-colors"
            style={{
              background: tab === t ? "#FFC803" : "var(--bg-primary)",
              border: "1px solid var(--border)",
              color: tab === t ? "#111" : "var(--text-secondary)",
              fontFamily: "var(--font-montserrat)",
            }}>
            {t === "analisi" ? "Analisi" : t === "storico" ? "Storico" : "Monitoraggio"}
          </button>
        ))}
      </div>

      {tab === "analisi" ? (
        <>
          {/* Form parametri */}
          <div className="rounded-2xl p-4 md:p-5 space-y-3" style={{ background: "#fff", border: "1px solid var(--border)" }}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Mercato</label>
                <select value={marketIdx} onChange={(e) => setMarketIdx(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()}>
                  {MARKETS.map((m, i) => <option key={m.label} value={i}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Marca</label>
                <select value={marca} onChange={(e) => setMarca(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()}>
                  <option value="">Tutte le marche</option>
                  {marche.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Stock minimo</label>
                <input type="number" value={minStock} onChange={(e) => setMinStock(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()} />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Soglia livello 2 (%)</label>
                <input type="number" step="0.5" value={sogliaDeltaPct} onChange={(e) => setSogliaDeltaPct(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()} />
                <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>Sopra questa soglia si chiama /distributorList (a pagamento)</p>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Margine fisso (€)</label>
                <input type="number" step="0.5" value={margineFisso} onChange={(e) => setMargineFisso(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()} />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Spedizione (€)</label>
                <input type="number" step="0.5" value={spedizione} onChange={(e) => setSpedizione(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()} />
                <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>Tipico: 4 Italia, 7 estero</p>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Commissione Tyre24 (%)</label>
                <input type="number" step="0.1" value={commissionePct} onChange={(e) => setCommissionePct(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()} />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Vantaggio prezzo (€)</label>
                <input type="number" step="0.05" value={pricingAdvantage} onChange={(e) => setPricingAdvantage(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()} />
                <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>Di quanto scendere sotto il concorrente</p>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Limite prodotti (test)</label>
                <input type="number" placeholder="tutti" value={limitTest} onChange={(e) => setLimitTest(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()} />
              </div>
            </div>

            <button onClick={avviaAnalisi} disabled={starting || (job?.Stato === "running")}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50"
              style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}>
              <Play size={14} />
              {starting ? "Avvio…" : job?.Stato === "running" ? "Analisi in corso…" : "Avvia Analisi"}
            </button>
          </div>

          {/* Progress job */}
          {job && (
            <div className="rounded-2xl p-4" style={{ background: "#fff", border: "1px solid var(--border)" }}>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${progress * 100}%`, background: job.Stato === "error" ? "#EF4444" : job.Stato === "running" ? "var(--brand)" : "#22C55E" }} />
              </div>
              <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>
                {job.Processati}/{job.Totale} prodotti · {job.SearchCalls} chiamate search · {job.DistributorCalls} chiamate distributorList (a pagamento)
                {job.Errori > 0 ? ` · ${job.Errori} errori` : ""}
                {job.Stato === "error" && job.Error ? ` — ${job.Error}` : ""}
              </p>
            </div>
          )}

          {/* Risultati */}
          {jobId && (
            <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between p-3 flex-wrap gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="flex gap-2 flex-wrap">
                  <select value={filterStato} onChange={(e) => setFilterStato(e.target.value as typeof filterStato)}
                    className="px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()}>
                    <option value="ok">Solo trovati su Tyre24</option>
                    <option value="">Tutti (inclusi non trovati)</option>
                    <option value="no_match">Solo non trovati su Tyre24</option>
                    <option value="errore">Solo errori</option>
                  </select>
                  <select value={filterLivello2} onChange={(e) => setFilterLivello2(e.target.value as typeof filterLivello2)}
                    className="px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()}>
                    <option value="">Tutti i livelli</option>
                    <option value="true">Solo verificati (livello 2)</option>
                    <option value="false">Solo stimati (livello 1)</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <a href={`/api/tyre24/analisi/${jobId}/risultati?format=csv${filterStato ? `&stato=${filterStato}` : ""}${filterLivello2 ? `&livello2=${filterLivello2}` : ""}`}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                    <Download size={14} /> Export CSV
                  </a>
                  <a href={`/api/tyre24/analisi/${jobId}/risultati?format=xlsx${filterStato ? `&stato=${filterStato}` : ""}${filterLivello2 ? `&livello2=${filterLivello2}` : ""}`}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                    <Download size={14} /> Export XLSX
                  </a>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)", minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb", borderBottom: "1px solid var(--border)" }}>
                      {["Prodotto", "Prezzo attuale (mercato)", "Pos.", "Ek Stimato", "Ek Verificato", "PAV", "Suggerito", "Stato"].map((h) => (
                        <th key={h} className="py-2.5 px-3 text-left text-[10px] font-bold uppercase" style={{ color: "#4b5563" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={8} className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                        {loadingRows ? "Caricamento…" : "Nessun risultato ancora."}
                      </td></tr>
                    ) : rows.map((r) => (
                      <tr key={r.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td className="py-3 px-3">
                          <span className="text-sm">{r.titolo ?? r.sku ?? r.ean}</span>
                          {r.livello2 && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: "#ECFDF5", color: "#047857" }}>verificato</span>}
                        </td>
                        <td className="py-3 px-3 text-xs">{eur(r.prezzoAttualeMercato)}</td>
                        <td className="py-3 px-3 text-xs">{r.livello2 ? (r.nostraPos ?? "ASSENTI") : "—"}</td>
                        <td className="py-3 px-3 text-xs">{eur(r.ekStimato)}</td>
                        <td className="py-3 px-3 text-xs">{eur(r.ekVerificato)}{r.distributorNome ? ` (${r.distributorNome})` : ""}</td>
                        <td className="py-3 px-3 text-xs">{eur(r.pav)}</td>
                        <td className="py-3 px-3 text-xs font-semibold">{eur(r.prezzoSuggerito)}</td>
                        <td className="py-3 px-3 text-xs">
                          {r.stato === "ok" ? "OK" : r.stato === "no_match" ? "Nessun match" : "Errore"}
                          {r.note ? ` — ${r.note}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {hasMoreRows && (
                <div className="p-3 flex justify-center" style={{ borderTop: "1px solid var(--border)" }}>
                  <button onClick={() => loadRisultati(rows.length, false)} disabled={loadingRows}
                    className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
                    {loadingRows ? "Caricamento…" : "Carica altri"}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      ) : tab === "storico" ? (
        <>
          {/* Storico analisi passate */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid var(--border)" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)", minWidth: 700 }}>
                <thead>
                  <tr style={{ background: "#f9fafb", borderBottom: "1px solid var(--border)" }}>
                    {["Data", "Mercato", "Marca", "Totale", "Con variazione", "Stato"].map((h) => (
                      <th key={h} className="py-2.5 px-3 text-left text-[10px] font-bold uppercase" style={{ color: "#4b5563" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {storico.length === 0 ? (
                    <tr><td colSpan={6} className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                      {loadingStorico ? "Caricamento…" : "Nessuna analisi ancora."}
                    </td></tr>
                  ) : storico.map((j) => (
                    <tr key={j.id} onClick={() => apriJobDaStorico(j.id)} style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}>
                      <td className="py-3 px-3 text-xs">{j.CreatedAt ? new Date(j.CreatedAt).toLocaleString("it-IT") : "—"}</td>
                      <td className="py-3 px-3 text-xs uppercase">{j.Paese}</td>
                      <td className="py-3 px-3 text-xs">{j.Marca ?? "Tutte"}</td>
                      <td className="py-3 px-3 text-xs">{j.Totale}</td>
                      <td className="py-3 px-3 text-xs">{j.ConVariazione}</td>
                      <td className="py-3 px-3 text-xs">{j.Stato}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {hasMoreStorico && (
              <div className="p-3 flex justify-center" style={{ borderTop: "1px solid var(--border)" }}>
                <button onClick={() => loadStorico(storico.length, false)} disabled={loadingStorico}
                  className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
                  {loadingStorico ? "Caricamento…" : "Carica altri"}
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Monitoraggio */}
          <div className="flex justify-end">
            <button onClick={loadMonitor} disabled={loadingMonitor}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
              <RefreshCw size={13} className={loadingMonitor ? "animate-spin" : ""} /> Aggiorna
            </button>
          </div>

          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 md:gap-4">
            <StatCard label="Search oggi" value={kpi?.searchCallsOggi ?? 0} sub="chiamate economiche" icon={<Search className="w-4 h-4 md:w-[22px] md:h-[22px]" />} accent="#2563EB" />
            <StatCard label="DistributorList oggi" value={kpi?.distributorCallsOggi ?? 0} sub="chiamate a pagamento" icon={<Layers className="w-4 h-4 md:w-[22px] md:h-[22px]" />} accent="#F43F5E" />
            <StatCard label="DistributorList (30gg)" value={kpi?.distributorCallsMese ?? 0} sub="totale mese" icon={<TrendingUp className="w-4 h-4 md:w-[22px] md:h-[22px]" />} accent="#F59E0B" />
            <StatCard label="Errori (30gg)" value={kpi?.erroriMese ?? 0} sub="chiamate fallite" icon={<AlertTriangle className="w-4 h-4 md:w-[22px] md:h-[22px]" />} accent="#EF4444" />
          </div>

          <div className="rounded-2xl p-4 md:p-5" style={{ background: "#fff", border: "1px solid var(--border)" }}>
            <p className="text-sm font-bold mb-3" style={{ fontFamily: "var(--font-poppins)" }}>Chiamate API — ultimi 30 giorni</p>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={serie} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="giorno" tickFormatter={formatDayShort} tick={{ fontSize: 11, fontFamily: "var(--font-montserrat)" }} />
                <YAxis tick={{ fontSize: 11, fontFamily: "var(--font-montserrat)" }} allowDecimals={false} />
                <Tooltip labelFormatter={(label) => formatDayShort(String(label))} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: "var(--font-montserrat)" }} />
                <Line type="monotone" dataKey="search" name="Search" stroke="#2563EB" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="distributorList" name="DistributorList" stroke="#F43F5E" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
