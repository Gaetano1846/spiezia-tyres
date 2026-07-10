"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { Truck, Search, Printer, Eye, RefreshCw, X, ChevronDown, SlidersHorizontal, CalendarDays, Trash2, MapPin, Send, Share2 } from "lucide-react";
import StatCard from "@/components/ui/StatCard";
import CalendarRangePicker from "@/components/ui/CalendarRangePicker";
import AnchoredPopover from "@/components/ui/AnchoredPopover";
import HeaderFilter from "@/components/ui/HeaderFilter";
import toast from "react-hot-toast";
import type { SpedizioneApi } from "@/lib/spedizioniDb";
import type { SimpleEntity } from "@/lib/lookupDb";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_COLORS: Record<string, { bg: string; color: string }> = {
  B2B:            { bg: "#FFC803", color: "#111" },
  eBay:           { bg: "#92C821", color: "#fff" },
  Amazon:         { bg: "#2196F3", color: "#fff" },
  WooCommerce:    { bg: "#7F54B3", color: "#fff" },
  Tyre24:         { bg: "#EC7522", color: "#fff" },
  T24:            { bg: "#EC7522", color: "#fff" },
  "Prezzo-Gomme": { bg: "#1565C0", color: "#fff" },
  AdTyres:        { bg: "#E8E8E8", color: "#374151" },
  Anonimo:        { bg: "#E8E8E8", color: "#374151" },
};

const STATO_GLS_LABELS: Record<string, string> = {
  created: "Creata",
  closed:  "Chiusa",
  deleted: "Eliminata",
};

const STATO_GLS_COLORS: Record<string, { bg: string; color: string }> = {
  created: { bg: "#FEF9C3", color: "#B45309" },
  closed:  { bg: "#D1FAE5", color: "#065F46" },
  deleted: { bg: "#FEE2E2", color: "#991B1B" },
};

const STATO_MAG_COLORS: Record<string, { bg: string; color: string }> = {
  "In Preparazione": { bg: "#DBEAFE", color: "#1E40AF" },
  Annullato:         { bg: "#FEE2E2", color: "#991B1B" },
  Spedito:           { bg: "#D1FAE5", color: "#065F46" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function formatISOToDisplay(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function sedeGlsLabel(contractIndex: number | null): string {
  if (contractIndex === 0) return "GLS Nola";
  if (contractIndex === 1) return "GLS Roma";
  return "—";
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function RowSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i}>
          <td colSpan={11} className="py-1 px-2">
            <div className="h-12 rounded-xl animate-pulse" style={{ background: "#f3f4f6" }} />
          </td>
        </tr>
      ))}
    </>
  );
}

// Selettore intervallo date (da–a): trigger + calendario in popover ancorato.
// Stessa UX della pagina Ordini (CalendarRangePicker + AnchoredPopover).
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SpedizioniPage() {
  const router = useRouter();
  const [rows, setRows]       = useState<SpedizioneApi[]>([]);
  const [capped, setCapped]   = useState(false); // true se la query ha toccato il limite
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Card mobile espandibili (tendina)
  const [expandedSpedizioni, setExpandedSpedizioni] = useState<Set<string>>(new Set());
  function toggleSpedDetails(id: string) {
    setExpandedSpedizioni((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  // Filtri collassabili su mobile
  const [showFilters, setShowFilters] = useState(false);

  // Top-bar filters
  const [search,  setSearch]  = useState("");
  const [dataDa,  setDataDa]  = useState(todayStr());
  const [dataA,   setDataA]   = useState(todayStr());
  const [sedeGLS, setSedeGLS] = useState("");   // "" | "0" | "1"

  // In-column header filters
  const [fonte,    setFonte]    = useState("");
  const [corriere, setCorriere] = useState("");
  const [magazzino, setMagazzino] = useState("");
  const [statoGLS,  setStatoGLS]  = useState("");
  const [statoMag,  setStatoMag]  = useState("");

  // Azioni bulk
  const [sediOptions, setSediOptions] = useState<SimpleEntity[]>([]);
  const [showSedeModal, setShowSedeModal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // KPI via count aggregate (non caricano i documenti). kpiTick forza il ricalcolo
  // dopo le azioni bulk (Trasmetti/Elimina/Imposta Sede) che cambiano gli stati.
  const [kpi, setKpi] = useState<{ daSpedire: number | null; inTransito: number | null; anomalie: number | null }>(
    { daSpedire: null, inTransito: null, anomalie: null }
  );
  const [kpiTick, setKpiTick] = useState(0);

  // ── Lista (filtro data lato server) ─────────────────────────────────────
  // La query carica SOLO l'intervallo date selezionato, ordinato per created_at
  // desc, con un tetto di sicurezza (LIST_LIMIT lato API). I filtri Fonte/
  // Corriere/Magazzino/Stati + ricerca restano client-side su questo insieme
  // ridotto (poche centinaia di righe): istantanei, zero query aggiuntive.
  useEffect(() => {
    setLoading(true);
    fetch(`/api/spedizioni?da=${dataDa}&a=${dataA}`)
      .then((r) => r.json())
      .then(({ spedizioni, capped: isCapped }) => {
        setRows(spedizioni ?? []);
        setCapped(!!isCapped);
      })
      .catch((err) => {
        console.error(err);
        toast.error("Errore nel caricamento spedizioni");
      })
      .finally(() => setLoading(false));
  }, [dataDa, dataA]);

  // ── KPI (count aggregate lato server) ───────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch("/api/spedizioni/kpi")
      .then((r) => r.json())
      .then(({ kpi: k }) => { if (!cancelled) setKpi(k ?? { daSpedire: null, inTransito: null, anomalie: null }); })
      .catch((e) => console.error("KPI error:", e));
    return () => { cancelled = true; };
  }, [kpiTick]);

  // Opzioni Sede magazzino (Nola, Nola 2, Volla, Roma, Portici) per il modal
  // "Imposta Sede Magazzino".
  useEffect(() => {
    fetch("/api/lookup/sede")
      .then((r) => r.json())
      .then(({ items }) => setSediOptions(items ?? []))
      .catch(() => {});
  }, []);

  // ── Stats: "In transito"/"Anomalie"/"Da spedire" da count aggregate server;
  //    "Consegnate oggi" calcolato dalle righe caricate (chiuse in data odierna).
  const stats = useMemo(() => {
    const consegnateOggi = rows.filter((d) => d.Status === "closed" && isToday(d.CreatedAt)).length;
    return [
      { label: "Da spedire",      value: kpi.daSpedire ?? "—",  sub: "in attesa",     accent: "#FFC803" },
      { label: "In transito",     value: kpi.inTransito ?? "—", sub: "in viaggio",    accent: "#EE8B60" },
      { label: "Consegnate oggi", value: consegnateOggi,        sub: "confermate",    accent: "#249689" },
      { label: "Anomalie",        value: kpi.anomalie ?? "—",   sub: "da verificare", accent: "#FF5963" },
    ];
  }, [kpi, rows]);

  // ── Filtered rows ───────────────────────────────────────────────────────
  const filtered = useMemo(() => rows.filter((r) => {
    if (sedeGLS  !== "" && r.ContractIndex !== Number(sedeGLS)) return false;
    if (fonte    && r.Source          !== fonte)    return false;
    if (corriere && r.Corriere        !== corriere) return false;
    if (magazzino && !r.MagazzinoLabel.toLowerCase().includes(magazzino.toLowerCase())) return false;
    if (statoGLS && r.Status          !== statoGLS) return false;
    if (statoMag && r.WarehouseStatus !== statoMag) return false;
    if (search) {
      const q = search.toLowerCase();
      if (![r.ParcelId, r.OrderIdExt, r.DestinationName].some((v) => v?.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [rows, sedeGLS, fonte, corriere, magazzino, statoGLS, statoMag, search]);

  const today = todayStr();
  const isDefaultRange = dataDa === today && dataA === today;

  // ── Dynamic dropdown options ────────────────────────────────────────────
  const fontiList    = useMemo(() => [...new Set(rows.map((r) => r.Source).filter(Boolean))].sort()     as string[], [rows]);
  const corrieriList = useMemo(() => [...new Set(rows.map((r) => r.Corriere).filter(Boolean))].sort()   as string[], [rows]);
  const magazzinoList= useMemo(() => [...new Set(rows.map((r) => r.MagazzinoLabel).filter((v) => v !== "—"))].sort(), [rows]);

  // ── Selection ───────────────────────────────────────────────────────────
  const allSelected = filtered.length > 0 && selected.size === filtered.length;
  function toggleAll()     { setSelected(allSelected ? new Set() : new Set(filtered.map((r) => r.id))); }
  function toggleOne(id: string) {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  function reset() {
    setSearch(""); setDataDa(todayStr()); setDataA(todayStr()); setSedeGLS("");
    setFonte(""); setCorriere(""); setMagazzino(""); setStatoGLS(""); setStatoMag("");
    setSelected(new Set());
  }

  // Trasmetti Spedizioni — mirror FlutterFlow: GLS → CloseMultipleOrdersGLSCall,
  // action "closeMultipleOrders" con gli ID ordine delle spedizioni GLS. La CF
  // raggruppa per contratto, chiude i colli e porta gli ordini a "Spedito".
  // SDA (corriere dismesso) è escluso dal filtro — eventuali righe storiche con
  // Corriere==="SDA" restano visibili in lista ma non vengono processate qui.
  async function handleChiudiManifesto() {
    const glsSelected = filtered.filter((r) => selected.has(r.id) && r.Corriere !== "SDA" && r.OrdineId);
    if (glsSelected.length === 0) {
      toast.error("Nessuna spedizione GLS selezionata");
      return;
    }
    const ordiniIds = [...new Set(glsSelected.map((r) => r.OrdineId!))];

    setBusy("trasmetti");
    const toastId = toast.loading(`Trasmissione spedizioni… GLS: ${ordiniIds.length} ordini`);
    try {
      const msgs: string[] = [];
      let hadError = false;

      const res = await fetch("/api/gls-italy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "closeMultipleOrders", ordiniIds }),
      });
      const data = await res.json().catch(() => null) as { error?: string; data?: { totalParcelsClosed?: number; totalParcelsFailed?: number } } | null;
      if (!res.ok) { hadError = true; msgs.push(`GLS: errore (${data?.error || res.status})`); }
      else {
        const failed = data?.data?.totalParcelsFailed ?? 0;
        const closed = data?.data?.totalParcelsClosed ?? 0;
        if (failed > 0) hadError = true;
        msgs.push(`GLS: ${closed} ok${failed ? `, ${failed} falliti` : ""}`);
      }

      toast.dismiss(toastId);
      if (hadError) toast.error(`Trasmissione con errori — ${msgs.join(" · ")}`);
      else toast.success(`Spedizioni trasmesse — ${msgs.join(" · ")}`);
      setSelected(new Set());
    } catch (e) {
      toast.dismiss(toastId);
      toast.error(`Errore trasmissione: ${e instanceof Error ? e.message : "sconosciuto"}`);
    } finally {
      setBusy(null);
      setKpiTick((k) => k + 1);
    }
  }

  // Aggiorna Tracking (marketplace) — mirror FlutterFlow: per ogni ordine collegato
  // alle spedizioni selezionate, spinge il tracking al marketplace di origine in
  // base a Source (Tyre24/Anonimo → Alzura, eBay, Amazon, AdTyres). Le fonti senza
  // marketplace (B2B/WooCommerce/Prezzo-Gomme) vengono saltate. Un push per ordine.
  async function handleAggiornaTrackingMarketplace() {
    const sel = filtered.filter((r) => selected.has(r.id) && r.OrdineId);
    if (sel.length === 0) { toast.error("Nessuna spedizione con ordine collegato"); return; }
    // Dedup per ordine, mantenendo il corriere della prima spedizione dell'ordine.
    const perOrder = new Map<string, string>();
    for (const r of sel) {
      const oid = r.OrdineId!;
      if (!perOrder.has(oid)) perOrder.set(oid, r.Corriere ?? "GLS");
    }
    const entries = [...perOrder.entries()];

    setBusy("mktracking");
    const toastId = toast.loading(`Aggiornamento tracking marketplace — ${entries.length} ordini…`);
    try {
      const results = await Promise.allSettled(
        entries.map(([ordineId, corriere]) =>
          fetch("/api/marketplace", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "pushTracking", ordineId, corriere }),
          }).then(async (res) => {
            const data = await res.json().catch(() => null) as { error?: string; data?: { source?: string; ok?: boolean; skipped?: boolean } } | null;
            if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
            return data?.data ?? { ok: false };
          })
        )
      );

      let ok = 0, ko = 0, skipped = 0;
      for (const r of results) {
        if (r.status === "fulfilled") {
          if (r.value?.skipped) skipped++;
          else if (r.value?.ok) ok++;
          else ko++;
        } else ko++;
      }

      toast.dismiss(toastId);
      const parts: string[] = [];
      if (ok) parts.push(`${ok} aggiornati`);
      if (skipped) parts.push(`${skipped} senza marketplace`);
      if (ko) parts.push(`${ko} falliti`);
      const summary = parts.join(", ") || "nessuna operazione";
      if (ko === 0) toast.success(`Tracking marketplace: ${summary}`);
      else toast.error(`Tracking marketplace: ${summary}`);
    } catch (e) {
      toast.dismiss(toastId);
      toast.error(`Errore aggiornamento tracking: ${e instanceof Error ? e.message : "sconosciuto"}`);
    } finally {
      setBusy(null);
    }
  }

  // Elimina Spedizioni — mirror FlutterFlow (DeleteMultipleOrdersGLSCall):
  // action "deleteMultipleOrders" con gli ID ordine. La CF annulla TUTTI i colli
  // di quegli ordini presso GLS (DeleteSped) e marca i doc Spedizioni "deleted".
  // Irreversibile. (Il FF non chiedeva conferma; qui la aggiungiamo per sicurezza.)
  async function handleElimina() {
    const glsSelected = filtered.filter((r) => selected.has(r.id) && r.Corriere !== "SDA" && r.OrdineId);
    if (glsSelected.length === 0) { toast.error("Nessuna spedizione GLS selezionata"); return; }
    const ordiniIds = [...new Set(glsSelected.map((r) => r.OrdineId!))];
    if (!window.confirm(`Eliminare le spedizioni GLS di ${ordiniIds.length} ordini? Annulla i colli presso GLS e non è reversibile.`)) return;

    setBusy("elimina");
    const toastId = toast.loading(`Eliminazione spedizioni GLS — ${ordiniIds.length} ordini…`);
    try {
      const res = await fetch("/api/gls-italy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteMultipleOrders", ordiniIds }),
      });
      const data = await res.json().catch(() => null) as { error?: string; data?: { totalParcelsDeleted?: number; totalParcelsFailed?: number } } | null;
      if (!res.ok) throw new Error(data?.error || `CF ${res.status}`);
      toast.dismiss(toastId);
      const failed = data?.data?.totalParcelsFailed ?? 0;
      if (failed === 0) toast.success(`Spedizioni eliminate (${ordiniIds.length} ordini)`);
      else toast.error(`Eliminate con errori: ${data?.data?.totalParcelsDeleted ?? 0} ok, ${failed} falliti`);
      setSelected(new Set());
    } catch (e) {
      toast.dismiss(toastId);
      toast.error(`Errore eliminazione: ${e instanceof Error ? e.message : "sconosciuto"}`);
    } finally {
      setBusy(null);
      setKpiTick((k) => k + 1);
    }
  }

  // Aggiorna Etichette GLS — rigenera le etichette/ZPL GLS degli ordini collegati
  // alle spedizioni selezionate (action "getZplBySped", per ordiniId). Stessa CF
  // del dettaglio ordine ("Aggiorna etichette GLS"). Un aggiornamento per ordine.
  // NB: NON è l'"Aggiorna Tracking" del FlutterFlow (push del tracking ai
  // marketplace), che richiede le CF marketplace non ancora portate qui.
  async function handleAggiornaTracking() {
    const glsSelected = filtered.filter((r) => selected.has(r.id) && r.Corriere !== "SDA" && r.OrdineId);
    if (glsSelected.length === 0) { toast.error("Nessuna spedizione GLS con ordine collegato"); return; }
    const orderIds = [...new Set(glsSelected.map((r) => r.OrdineId!))];

    setBusy("tracking");
    const toastId = toast.loading(`Aggiornamento etichette GLS — ${orderIds.length} ordini…`);
    try {
      const results = await Promise.allSettled(
        orderIds.map((ordiniId) =>
          fetch("/api/gls-italy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "getZplBySped", ordiniId }),
          }).then(async (res) => { if (!res.ok) throw new Error(`CF ${res.status}`); })
        )
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const ko = results.length - ok;
      toast.dismiss(toastId);
      if (ko === 0) toast.success(`Etichette GLS aggiornate (${ok} ordini)`);
      else toast.error(`Etichette GLS: ${ok} ok, ${ko} falliti`);
    } catch {
      toast.dismiss(toastId);
      toast.error("Errore nell'aggiornamento delle etichette GLS");
    } finally {
      setBusy(null);
    }
  }

  // Imposta Sede Magazzino — assegna il riferimento Sede (Nola, Nola 2, Volla,
  // Roma, Portici) alle spedizioni selezionate. Unica scrittura pura di questo
  // dominio (nessuna Cloud Function) — cutover su Postgres, propagata a
  // Firestore dal bridge.
  async function handleImpostaSede(sedeId: string) {
    const sel = filtered.filter((r) => selected.has(r.id));
    if (sel.length === 0) { setShowSedeModal(false); return; }

    setBusy("sede");
    const toastId = toast.loading("Impostazione sede magazzino…");
    try {
      const res = await fetch("/api/spedizioni/warehouse", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: sel.map((r) => r.id), sedeId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.dismiss(toastId);
      toast.success(`Sede impostata per ${sel.length} spedizioni`);
      setShowSedeModal(false);
      setSelected(new Set());
      // Ricarica la lista per riflettere subito il nuovo magazzino/stato.
      const listRes = await fetch(`/api/spedizioni?da=${dataDa}&a=${dataA}`);
      const { spedizioni, capped: isCapped } = await listRes.json();
      setRows(spedizioni ?? []);
      setCapped(!!isCapped);
    } catch {
      toast.dismiss(toastId);
      toast.error("Errore nell'impostazione della sede");
    } finally {
      setBusy(null);
      setKpiTick((k) => k + 1);
    }
  }

  function handleViewOrder(r: SpedizioneApi) {
    if (!r.OrdineId) { toast.error("Ordine non collegato"); return; }
    router.push(`/admin/ordini/${r.OrdineId}`);
  }

  async function handlePrintLabel(r: SpedizioneApi) {
    // SDA (corriere dismesso, reshark-shipping non più chiamata): righe storiche
    // restano visibili in lista ma la stampa etichetta non è più disponibile.
    if (r.Corriere === "SDA") {
      toast.error("Corriere SDA dismesso — etichetta non più disponibile");
      return;
    }

    // GLS: leggo GLS_PdfUrl dall'Ordine collegato (stesso comportamento del Flutter)
    if (!r.OrdineId) { toast.error("Ordine collegato non trovato"); return; }
    const toastId = toast.loading("Recupero etichetta GLS…");
    try {
      const ordineSnap = await getDoc(doc(db, "Ordini", r.OrdineId));
      if (!ordineSnap.exists()) throw new Error("Ordine non trovato");
      const pdfUrl = (ordineSnap.data() as Record<string, unknown>).GLS_PdfUrl as string | undefined;
      if (!pdfUrl) throw new Error("GLS_PdfUrl non disponibile su questo ordine");
      window.open(pdfUrl, "_blank");
      toast.dismiss(toastId);
    } catch (err) {
      toast.dismiss(toastId);
      const msg = err instanceof Error ? err.message : "Errore sconosciuto";
      toast.error(`Etichetta GLS non disponibile: ${msg}`);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-2.5 md:space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Spedizioni</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
          {loading ? "Caricamento…" : `${filtered.length} spedizioni${capped ? ` · primi 2000 dell'intervallo` : ""}`}
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 md:gap-4">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub}
            icon={<Truck className="w-4 h-4 md:w-[22px] md:h-[22px]" />} accent={s.accent} />
        ))}
      </div>

      {/* Top toolbar — ricerca + (desktop: Sede GLS · Data · Reset) / (mobile: toggle filtri).
          Su desktop Fonte/Corriere/Magazzino/Stato GLS/Stato Mag. sono nell'intestazione tabella. */}
      <div className="space-y-2">
       <div className="flex gap-2 items-center flex-wrap">
        <div className="relative flex-1 min-w-[150px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per ID, ordine, cliente…"
            className="w-full pl-9 pr-4 py-2 rounded-xl text-sm outline-none"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }} />
        </div>

        {/* Desktop: Sede GLS + Data + Reset a destra */}
        <div className="hidden md:flex items-center gap-2 ml-auto">
          <select value={sedeGLS} onChange={(e) => setSedeGLS(e.target.value)}
            className="px-3 py-2 rounded-xl text-sm outline-none cursor-pointer"
            style={{ background: sedeGLS ? "#FFF8DC" : "var(--bg-primary)", border: `1px solid ${sedeGLS ? "#FFC803" : "var(--border)"}`, fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
            <option value="">Sede GLS</option>
            <option value="0">GLS Nola</option>
            <option value="1">GLS Roma</option>
          </select>
          <DateRangeField dataDa={dataDa} dataA={dataA} onChange={(da, a) => { setDataDa(da); setDataA(a); }} />
          {(search || fonte || corriere || magazzino || statoGLS || statoMag || sedeGLS || !isDefaultRange) && (
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
          {(() => { const n = [fonte, corriere, magazzino, statoGLS, statoMag, sedeGLS, !isDefaultRange].filter(Boolean).length; return n > 0 ? (
            <span className="w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: "#111", color: "#FFC803" }}>{n}</span>
          ) : null; })()}
          <ChevronDown size={14} style={{ transform: showFilters ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
        </button>
        {(search || fonte || corriere || magazzino || statoGLS || statoMag || sedeGLS || !isDefaultRange) && (
          <button onClick={reset}
            className="md:hidden flex items-center gap-1 px-3 py-2 rounded-xl text-sm flex-shrink-0"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
            <X size={13} />
          </button>
        )}
       </div>

       {/* Mobile: pannello filtri collassabile (tutti i filtri) */}
       <div className={`${showFilters ? "flex" : "hidden"} md:hidden gap-2 flex-wrap items-center`}>
        <select value={fonte} onChange={(e) => setFonte(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm outline-none"
          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
          <option value="">Tutte le fonti</option>
          {fontiList.map((f) => <option key={f}>{f}</option>)}
        </select>
        <select value={corriere} onChange={(e) => setCorriere(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm outline-none"
          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
          <option value="">Tutti i corrieri</option>
          {corrieriList.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={magazzino} onChange={(e) => setMagazzino(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm outline-none"
          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
          <option value="">Tutti i magazzini</option>
          {magazzinoList.map((m) => <option key={m}>{m}</option>)}
        </select>
        <select value={statoGLS} onChange={(e) => setStatoGLS(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm outline-none"
          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
          <option value="">Stato GLS</option>
          <option value="created">Creata</option>
          <option value="closed">Chiusa</option>
          <option value="deleted">Eliminata</option>
        </select>
        <select value={statoMag} onChange={(e) => setStatoMag(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm outline-none"
          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
          <option value="">Stato magazzino</option>
          <option>In Preparazione</option>
          <option>Annullato</option>
          <option>Spedito</option>
        </select>
        <select value={sedeGLS} onChange={(e) => setSedeGLS(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm outline-none"
          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
          <option value="">Sede GLS</option>
          <option value="0">GLS Nola</option>
          <option value="1">GLS Roma</option>
        </select>
        <DateRangeField dataDa={dataDa} dataA={dataA} onChange={(da, a) => { setDataDa(da); setDataA(a); }} />
       </div>
      </div>

      {/* Bulk selection bar — azioni allineate al precedente progetto FlutterFlow:
          Trasmetti · Elimina · Aggiorna Tracking · Imposta Sede Magazzino. */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl flex-wrap"
          style={{ background: "#FFF8DC", border: "1px solid #FFC803", fontFamily: "var(--font-montserrat)" }}>
          <span className="text-sm font-bold mr-1" style={{ color: "#111" }}>
            {selected.size} selezionat{selected.size === 1 ? "a" : "e"}
          </span>

          <button
            onClick={handleChiudiManifesto}
            disabled={!!busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "#059669", color: "#fff" }}
            title="Trasmetti (chiudi manifesto) le spedizioni GLS selezionate"
          >
            <Send size={11} /> {busy === "trasmetti" ? "Trasmissione…" : "Trasmetti Spedizioni"}
          </button>

          <button
            onClick={handleElimina}
            disabled={!!busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "#DC2626", color: "#fff" }}
            title="Elimina le spedizioni GLS selezionate"
          >
            <Trash2 size={11} /> {busy === "elimina" ? "Eliminazione…" : "Elimina Spedizioni"}
          </button>

          <button
            onClick={handleAggiornaTracking}
            disabled={!!busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "#fff", color: "#374151", border: "1px solid #e5e7eb" }}
            title="Rigenera le etichette GLS (ZPL) degli ordini collegati"
          >
            <RefreshCw size={11} /> {busy === "tracking" ? "Aggiornamento…" : "Aggiorna Etichette GLS"}
          </button>

          <button
            onClick={handleAggiornaTrackingMarketplace}
            disabled={!!busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "#2563EB", color: "#fff" }}
            title="Comunica il tracking ai marketplace di origine (Tyre24, eBay, Amazon, AdTyres)"
          >
            <Share2 size={11} /> {busy === "mktracking" ? "Invio…" : "Aggiorna Tracking"}
          </button>

          <button
            onClick={() => setShowSedeModal(true)}
            disabled={!!busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "#fff", color: "#374151", border: "1px solid #e5e7eb" }}
            title="Imposta la sede magazzino delle spedizioni selezionate"
          >
            <MapPin size={11} /> Imposta Sede Magazzino
          </button>

          <button onClick={() => setSelected(new Set())} disabled={!!busy}
            className="ml-auto flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium disabled:opacity-50"
            style={{ background: "#e5e7eb", color: "#374151" }}>
            <X size={11} /> Deseleziona
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid var(--border)" }}>
        <div className="overflow-x-auto hidden md:block">
          <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)", minWidth: 1100 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid var(--border)" }}>

                {/* Checkbox all */}
                <th className="py-2.5 pl-4 pr-2 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    className="w-4 h-4 cursor-pointer" style={{ accentColor: "#FFC803" }} />
                </th>

                {/* Colonne etichetta (pill grigie) */}
                {["ID Spedizione", "Ordine", "Cliente", "Creato Il"].map((h) => (
                  <th key={h} className="py-2.5 pr-3 text-left whitespace-nowrap">
                    <span className="inline-block px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider"
                      style={{ background: "#eceef1", color: "#4b5563", fontFamily: "var(--font-montserrat)" }}>
                      {h}
                    </span>
                  </th>
                ))}

                {/* Colonne filtro — dropdown nell'intestazione, allineati alle colonne */}
                <th className="py-2.5 pr-3">
                  <HeaderFilter value={fonte} onChange={setFonte} title="Filtra per fonte">
                    <option value="">Fonte</option>
                    {fontiList.map((f) => <option key={f} value={f}>{f}</option>)}
                  </HeaderFilter>
                </th>
                <th className="py-2.5 pr-3">
                  <HeaderFilter value={corriere} onChange={setCorriere} title="Filtra per corriere">
                    <option value="">Corriere</option>
                    {corrieriList.map((c) => <option key={c} value={c}>{c}</option>)}
                  </HeaderFilter>
                </th>
                <th className="py-2.5 pr-3">
                  <HeaderFilter value={magazzino} onChange={setMagazzino} title="Filtra per magazzino">
                    <option value="">Magazzino</option>
                    {magazzinoList.map((m) => <option key={m} value={m}>{m}</option>)}
                  </HeaderFilter>
                </th>
                <th className="py-2.5 pr-3">
                  <HeaderFilter value={statoGLS} onChange={setStatoGLS} title="Filtra per stato GLS">
                    <option value="">Stato GLS</option>
                    <option value="created">Creata</option>
                    <option value="closed">Chiusa</option>
                    <option value="deleted">Eliminata</option>
                  </HeaderFilter>
                </th>
                <th className="py-2.5 pr-3">
                  <HeaderFilter value={statoMag} onChange={setStatoMag} title="Filtra per stato magazzino">
                    <option value="">Stato Mag.</option>
                    <option>In Preparazione</option>
                    <option>Annullato</option>
                    <option>Spedito</option>
                  </HeaderFilter>
                </th>
                <th className="py-2.5 pr-4 w-20" />
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <RowSkeleton />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                    Nessuna spedizione trovata.
                  </td>
                </tr>
              ) : (
                filtered.map((r, idx) => {
                  const srcStyle   = SOURCE_COLORS[r.Source ?? ""]          ?? { bg: "#e5e7eb", color: "#374151" };
                  const glsStyle   = STATO_GLS_COLORS[r.Status ?? ""]       ?? { bg: "#e5e7eb", color: "#374151" };
                  const magStyle   = STATO_MAG_COLORS[r.WarehouseStatus ?? ""] ?? { bg: "#e5e7eb", color: "#374151" };
                  const isSel      = selected.has(r.id);
                  const rowBg      = isSel ? "#FFFBEB" : idx % 2 === 0 ? "#fff" : "#fafafa";

                  return (
                    <tr key={r.id}
                      style={{ background: rowBg, borderBottom: "1px solid #f3f4f6" }}
                      onMouseEnter={(e) => { if (!isSel) (e.currentTarget as HTMLElement).style.background = "#FFFDE7"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = rowBg; }}>

                      <td className="py-3.5 pl-4 pr-2">
                        <input type="checkbox" checked={isSel} onChange={() => toggleOne(r.id)}
                          className="w-4 h-4 cursor-pointer" style={{ accentColor: "#FFC803" }} />
                      </td>

                      {/* ID Spedizione */}
                      <td className="py-3.5 pr-3">
                        <span className="font-mono text-xs font-bold" style={{ color: "#111" }}>
                          {r.ParcelId ?? r.id.slice(0, 8).toUpperCase()}
                        </span>
                      </td>

                      {/* Ordine */}
                      <td className="py-3.5 pr-3">
                        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                          {r.OrderIdExt ?? "—"}
                        </span>
                      </td>

                      {/* Cliente */}
                      <td className="py-3.5 pr-3">
                        <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                          {r.DestinationName ?? "—"}
                        </span>
                      </td>

                      {/* Creato Il */}
                      <td className="py-3.5 pr-3 whitespace-nowrap">
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          {formatDateTime(r.CreatedAt)}
                        </span>
                      </td>

                      {/* Fonte badge */}
                      <td className="py-3.5 pr-3">
                        {r.Source ? (
                          <span className="px-2.5 py-1 rounded-lg text-xs font-bold"
                            style={{ background: srcStyle.bg, color: srcStyle.color }}>
                            {r.Source}
                          </span>
                        ) : <span style={{ color: "var(--text-muted)" }}>—</span>}
                      </td>

                      {/* Corriere + Sede */}
                      <td className="py-3.5 pr-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{r.Corriere ?? "—"}</span>
                          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{sedeGlsLabel(r.ContractIndex)}</span>
                        </div>
                      </td>

                      {/* Magazzino */}
                      <td className="py-3.5 pr-3">
                        <span className="text-xs" style={{ color: "var(--text-primary)" }}>{r.MagazzinoLabel}</span>
                      </td>

                      {/* Stato GLS */}
                      <td className="py-3.5 pr-3">
                        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold"
                          style={{ background: glsStyle.bg, color: glsStyle.color }}>
                          {STATO_GLS_LABELS[r.Status ?? ""] ?? r.Status ?? "—"}
                        </span>
                      </td>

                      {/* Stato Magazzino */}
                      <td className="py-3.5 pr-3">
                        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold"
                          style={{ background: magStyle.bg, color: magStyle.color }}>
                          {r.WarehouseStatus ?? "—"}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 pr-4">
                        <div className="flex items-center gap-1.5">
                          <button title="Stampa etichetta" onClick={() => handlePrintLabel(r)}
                            className="p-1.5 rounded-lg transition-colors hover:bg-[#FFF8DC]"
                            style={{ color: "#FFC803", border: "1px solid #FFC803" }}>
                            <Printer size={13} />
                          </button>
                          <button title="Visualizza ordine" onClick={() => handleViewOrder(r)}
                            className="p-1.5 rounded-lg transition-colors hover:bg-[#FFF8DC]"
                            style={{ color: "#FFC803", border: "1px solid #FFC803" }}>
                            <Eye size={13} />
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

        {/* ── Card — mobile ── */}
        <div className="md:hidden">
          {/* Seleziona tutti */}
          <div className="flex items-center gap-2.5 px-3 py-2.5" style={{ background: "#f9fafb", borderBottom: "1px solid var(--border)" }}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4 cursor-pointer" style={{ accentColor: "#FFC803" }} />
            <span className="text-xs font-semibold" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>Seleziona tutti</span>
          </div>

          {loading ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-24 rounded-xl animate-pulse" style={{ background: "#f3f4f6" }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-14 text-center text-sm" style={{ color: "var(--text-muted)" }}>Nessuna spedizione trovata.</div>
          ) : (
            filtered.map((r) => {
              const srcStyle = SOURCE_COLORS[r.Source ?? ""] ?? { bg: "#e5e7eb", color: "#374151" };
              const glsStyle = STATO_GLS_COLORS[r.Status ?? ""] ?? { bg: "#e5e7eb", color: "#374151" };
              const magStyle = STATO_MAG_COLORS[r.WarehouseStatus ?? ""] ?? { bg: "#e5e7eb", color: "#374151" };
              const isSel = selected.has(r.id);
              const isOpen = expandedSpedizioni.has(r.id);
              return (
                <div key={r.id} className="p-3" style={{ borderBottom: "1px solid #f3f4f6", background: isSel ? "#FFFBEB" : undefined }}>
                  {/* ID + Fonte */}
                  <div className="flex items-center gap-2.5">
                    <input type="checkbox" checked={isSel} onChange={() => toggleOne(r.id)} className="w-4 h-4 cursor-pointer flex-shrink-0" style={{ accentColor: "#FFC803" }} />
                    <span className="font-mono text-xs font-bold flex-1 min-w-0 truncate" style={{ color: "#111" }}>
                      {r.ParcelId ?? r.id.slice(0, 8).toUpperCase()}
                    </span>
                    {r.Source && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold flex-shrink-0" style={{ background: srcStyle.bg, color: srcStyle.color }}>
                        {r.Source}
                      </span>
                    )}
                  </div>

                  {/* Cliente */}
                  <p className="text-xs mt-1.5 truncate" style={{ color: "var(--text-primary)" }}>{r.DestinationName ?? "—"}</p>

                  {/* Stati + toggle */}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: glsStyle.bg, color: glsStyle.color }}>
                      {STATO_GLS_LABELS[r.Status ?? ""] ?? r.Status ?? "—"}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: magStyle.bg, color: magStyle.color }}>
                      {r.WarehouseStatus ?? "—"}
                    </span>
                    <button
                      onClick={() => toggleSpedDetails(r.id)}
                      aria-expanded={isOpen}
                      className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors hover:bg-gray-100"
                      style={{ border: "1px solid #e5e7eb", color: "#374151", fontFamily: "var(--font-montserrat)" }}
                    >
                      {isOpen ? "Nascondi" : "Dettagli"}
                      <ChevronDown size={12} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                    </button>
                  </div>

                  {/* Tendina dettagli */}
                  {isOpen && (
                    <div className="mt-2 pt-2 flex flex-col gap-1.5 text-xs" style={{ borderTop: "1px dashed #e5e7eb", fontFamily: "var(--font-montserrat)" }}>
                      <div className="flex justify-between gap-3"><span style={{ color: "#9ca3af" }}>Ordine</span><span className="text-right" style={{ color: "var(--text-primary)" }}>{r.OrderIdExt ?? "—"}</span></div>
                      <div className="flex justify-between gap-3"><span style={{ color: "#9ca3af" }}>Creato il</span><span className="text-right" style={{ color: "var(--text-secondary)" }}>{formatDateTime(r.CreatedAt)}</span></div>
                      <div className="flex justify-between gap-3"><span style={{ color: "#9ca3af" }}>Corriere</span><span className="text-right" style={{ color: "var(--text-primary)" }}>{r.Corriere ?? "—"} · {sedeGlsLabel(r.ContractIndex)}</span></div>
                      <div className="flex justify-between gap-3"><span style={{ color: "#9ca3af" }}>Magazzino</span><span className="text-right" style={{ color: "var(--text-primary)" }}>{r.MagazzinoLabel}</span></div>
                      <div className="flex items-center gap-2 mt-1">
                        <button onClick={() => handlePrintLabel(r)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-[#FFF8DC]" style={{ color: "#111", border: "1px solid #FFC803" }}>
                          <Printer size={13} /> Etichetta
                        </button>
                        <button onClick={() => handleViewOrder(r)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-[#FFF8DC]" style={{ color: "#111", border: "1px solid #FFC803" }}>
                          <Eye size={13} /> Ordine
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modal "Imposta Sede Magazzino" — picker delle sedi */}
      {showSedeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget && !busy) setShowSedeModal(false); }}
        >
          <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: "#fff", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-base" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
                Imposta Sede Magazzino
              </h3>
              <button onClick={() => { if (!busy) setShowSedeModal(false); }} className="p-1 rounded-lg hover:bg-[#F1F4F8] disabled:opacity-40" disabled={!!busy}>
                <X size={18} style={{ color: "#6b7280" }} />
              </button>
            </div>
            <p className="text-xs mb-4" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
              Assegna la sede a {selected.size} spedizion{selected.size === 1 ? "e" : "i"} selezionat{selected.size === 1 ? "a" : "e"}.
            </p>
            {sediOptions.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                Nessuna sede disponibile.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {sediOptions.map((s) => (
                  <button
                    key={s.id}
                    disabled={!!busy}
                    onClick={() => handleImpostaSede(s.id)}
                    className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors hover:bg-[#FFF8DC] disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ border: "1px solid #FFC803", color: "#111", fontFamily: "var(--font-montserrat)", background: "#fff" }}
                  >
                    <MapPin size={14} style={{ color: "#FFC803" }} /> {s.Nome}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
