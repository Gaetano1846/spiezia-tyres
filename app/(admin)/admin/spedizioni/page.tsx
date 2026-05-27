"use client";

import { useState, useEffect, useMemo } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  getDoc,
  type DocumentReference,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { Truck, Search, Printer, Eye, RefreshCw, X } from "lucide-react";
import StatCard from "@/components/ui/StatCard";
import toast from "react-hot-toast";

// ---------------------------------------------------------------------------
// Types (matching actual Firestore schema from Flutter app)
// ---------------------------------------------------------------------------

type SpedizioneFS = {
  id: string;
  parcelId?: string;           // GLS shipment ID
  orderId?: string;            // Order number string
  orderReference?: DocumentReference;
  destinationName?: string;    // Customer name (already a string)
  createdAt?: Timestamp;
  Source?: string;             // "B2B"|"eBay"|"Amazon"|"Tyre24"|"WooCommerce"|"Prezzo-Gomme"|"Anonimo"|"AdTyres"
  Corriere?: string;           // "GLS" | "SDA"
  contractIndex?: number;      // 0 = GLS Nola, 1 = GLS Roma
  Warehouse?: DocumentReference;
  status?: string;             // "created" | "closed" | "deleted"
  warehouseStatus?: string;    // "In Preparazione" | "Annullato" | "Spedito"
  motivoAnnullamento?: string;
  noteAggiuntive?: string;
};

type SpedizioneRow = SpedizioneFS & {
  sedeLabel: string;
  magazzinoLabel: string;
};

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

function formatDateTime(ts?: Timestamp): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("it-IT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function isOnDate(ts?: Timestamp, dateStr?: string): boolean {
  if (!ts || !dateStr) return true;
  const d = ts.toDate();
  const [y, m, day] = dateStr.split("-").map(Number);
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isToday(ts?: Timestamp): boolean {
  if (!ts) return false;
  const d = ts.toDate();
  const now = new Date();
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SpedizioniPage() {
  const router = useRouter();
  const [rawDocs, setRawDocs] = useState<SpedizioneFS[]>([]);
  const [rows, setRows]       = useState<SpedizioneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Top-bar filters
  const [search,  setSearch]  = useState("");
  const [date,    setDate]    = useState(todayStr());
  const [sedeGLS, setSedeGLS] = useState("");   // "" | "0" | "1"

  // In-column header filters
  const [fonte,    setFonte]    = useState("");
  const [corriere, setCorriere] = useState("");
  const [magazzino, setMagazzino] = useState("");
  const [statoGLS,  setStatoGLS]  = useState("");
  const [statoMag,  setStatoMag]  = useState("");

  // ── Real-time listener ──────────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, "Spedizioni"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      async (snap) => {
        const docs: SpedizioneFS[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<SpedizioneFS, "id">),
        }));
        setRawDocs(docs);

        // Resolve Warehouse refs in batch
        const wareRefs = [...new Map(
          docs.filter((d) => d.Warehouse).map((d) => [d.Warehouse!.path, d.Warehouse!])
        ).values()];
        const wareSnaps = await Promise.all(wareRefs.map((r) => getDoc(r)));
        const wareMap = new Map<string, string>();
        for (const s of wareSnaps) {
          if (s.exists()) {
            const data = s.data() as Record<string, unknown>;
            wareMap.set(s.ref.path, (data.Nome as string) ?? (data.name as string) ?? s.id);
          }
        }

        setRows(
          docs.map((d) => ({
            ...d,
            sedeLabel:
              d.contractIndex === 0 ? "GLS Nola" :
              d.contractIndex === 1 ? "GLS Roma" : "—",
            magazzinoLabel:
              d.Warehouse ? (wareMap.get(d.Warehouse.path) ?? d.Warehouse.id) : "—",
          }))
        );
        setLoading(false);
      },
      (err) => {
        console.error(err);
        toast.error("Errore nel caricamento spedizioni");
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // ── Stats (from all docs) ───────────────────────────────────────────────
  const stats = useMemo(() => [
    { label: "Da spedire",      value: rawDocs.filter((d) => d.status === "created" && d.warehouseStatus === "In Preparazione").length, sub: "in attesa",     accent: "#FFC803" },
    { label: "In transito",     value: rawDocs.filter((d) => d.status === "closed").length,                                              sub: "in viaggio",    accent: "#EE8B60" },
    { label: "Consegnate oggi", value: rawDocs.filter((d) => d.status === "closed" && isToday(d.createdAt)).length,                      sub: "confermate",    accent: "#249689" },
    { label: "Anomalie",        value: rawDocs.filter((d) => d.warehouseStatus === "Annullato").length,                                  sub: "da verificare", accent: "#FF5963" },
  ], [rawDocs]);

  // ── Filtered rows ───────────────────────────────────────────────────────
  const filtered = useMemo(() => rows.filter((r) => {
    if (date     && !isOnDate(r.createdAt, date)) return false;
    if (sedeGLS  !== "" && r.contractIndex !== Number(sedeGLS)) return false;
    if (fonte    && r.Source        !== fonte)    return false;
    if (corriere && r.Corriere      !== corriere) return false;
    if (magazzino && !r.magazzinoLabel.toLowerCase().includes(magazzino.toLowerCase())) return false;
    if (statoGLS && r.status        !== statoGLS) return false;
    if (statoMag && r.warehouseStatus !== statoMag) return false;
    if (search) {
      const q = search.toLowerCase();
      if (![r.parcelId, r.orderId, r.destinationName].some((v) => v?.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [rows, date, sedeGLS, fonte, corriere, magazzino, statoGLS, statoMag, search]);

  // ── Dynamic dropdown options ────────────────────────────────────────────
  const fontiList    = useMemo(() => [...new Set(rows.map((r) => r.Source).filter(Boolean))].sort()     as string[], [rows]);
  const corrieriList = useMemo(() => [...new Set(rows.map((r) => r.Corriere).filter(Boolean))].sort()   as string[], [rows]);
  const magazzinoList= useMemo(() => [...new Set(rows.map((r) => r.magazzinoLabel).filter((v) => v !== "—"))].sort(), [rows]);

  // ── Selection ───────────────────────────────────────────────────────────
  const allSelected = filtered.length > 0 && selected.size === filtered.length;
  function toggleAll()     { setSelected(allSelected ? new Set() : new Set(filtered.map((r) => r.id))); }
  function toggleOne(id: string) {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  function reset() {
    setSearch(""); setDate(todayStr()); setSedeGLS("");
    setFonte(""); setCorriere(""); setMagazzino(""); setStatoGLS(""); setStatoMag("");
    setSelected(new Set());
  }

  async function handleChiudiManifesto() {
    const glsSelected = filtered.filter((r) => selected.has(r.id) && r.Corriere !== "SDA");
    if (glsSelected.length === 0) { toast.error("Nessuna spedizione GLS selezionata"); return; }

    // Group by contractIndex (0=Nola, 1=Roma)
    const byContract = new Map<number, typeof glsSelected>();
    for (const r of glsSelected) {
      const ci = r.contractIndex ?? 0;
      if (!byContract.has(ci)) byContract.set(ci, []);
      byContract.get(ci)!.push(r);
    }

    const toastId = toast.loading("Chiusura manifesto GLS…");
    try {
      await Promise.all(
        [...byContract.entries()].map(([contractIndex]) =>
          fetch(
            `https://europe-west1-crm-3iuocs.cloudfunctions.net/gls-italy?action=close&contractIndex=${contractIndex}`,
            { method: "POST" }
          )
        )
      );
      toast.dismiss(toastId);
      toast.success(`Manifesto chiuso per ${glsSelected.length} spedizioni`);
      setSelected(new Set());
    } catch {
      toast.dismiss(toastId);
      toast.error("Errore nella chiusura del manifesto");
    }
  }

  function handleViewOrder(r: SpedizioneRow) {
    const orderId = r.orderReference?.id;
    if (!orderId) { toast.error("Ordine non collegato"); return; }
    router.push(`/admin/ordini/${orderId}`);
  }

  async function handlePrintLabel(r: SpedizioneRow) {
    if (!r.parcelId) { toast.error("Nessun ID spedizione disponibile"); return; }
    const isSDA  = r.Corriere === "SDA";
    const toastId = toast.loading(`Recupero etichetta ${isSDA ? "SDA" : "GLS"}…`);
    try {
      const url = isSDA
        ? `https://europe-west1-crm-3iuocs.cloudfunctions.net/reshark-shipping?action=label&parcelId=${r.parcelId}`
        : `https://europe-west1-crm-3iuocs.cloudfunctions.net/gls-italy?action=label&parcelId=${r.parcelId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`CF error ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      window.open(objUrl, "_blank");
      toast.dismiss(toastId);
    } catch {
      toast.dismiss(toastId);
      toast.error(`Impossibile recuperare l'etichetta ${isSDA ? "SDA" : "GLS"}`);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Spedizioni</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
          {loading ? "Caricamento…" : `${filtered.length} spedizioni`}
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub}
            icon={<Truck size={22} />} accent={s.accent} />
        ))}
      </div>

      {/* Top filters bar */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per ID, ordine, cliente…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }} />
        </div>

        <select value={sedeGLS} onChange={(e) => setSedeGLS(e.target.value)}
          className="px-3 py-2.5 rounded-xl text-sm outline-none"
          style={{ background: sedeGLS ? "#FFF8DC" : "var(--bg-secondary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
          <option value="">Sede GLS</option>
          <option value="0">GLS Nola</option>
          <option value="1">GLS Roma</option>
        </select>

        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2.5 rounded-xl text-sm outline-none"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }} />

        <button onClick={reset}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
          <RefreshCw size={14} /> Reset
        </button>
      </div>

      {/* Bulk selection bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl flex-wrap"
          style={{ background: "#FFF8DC", border: "1px solid #FFC803", fontFamily: "var(--font-montserrat)" }}>
          <span className="text-sm font-bold" style={{ color: "#111" }}>{selected.size} selezionati</span>
          <button
            onClick={handleChiudiManifesto}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors"
            style={{ background: "#111", color: "#FFC803" }}
            title="Chiudi manifesto GLS per le spedizioni selezionate"
          >
            <Printer size={11} /> Chiudi Manifesto GLS
          </button>
          <button onClick={() => setSelected(new Set())}
            className="ml-auto flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium"
            style={{ background: "#e5e7eb", color: "#374151" }}>
            <X size={11} /> Deseleziona
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid var(--border)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)", minWidth: 1100 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid var(--border)" }}>

                {/* Checkbox all */}
                <th className="py-3 pl-4 pr-2 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    className="w-4 h-4 cursor-pointer" style={{ accentColor: "#FFC803" }} />
                </th>

                {/* Static label columns */}
                {[
                  { key: "parcelId",  label: "ID Spedizione" },
                  { key: "orderId",   label: "Ordine" },
                  { key: "destName",  label: "Cliente" },
                  { key: "createdAt", label: "Creato Il" },
                ].map((c) => (
                  <th key={c.key} className="py-3 pr-3 text-left text-[10px] font-bold uppercase tracking-widest whitespace-nowrap"
                    style={{ color: "var(--text-muted)" }}>
                    {c.label}
                  </th>
                ))}

                {/* Fonte dropdown-header */}
                <th className="py-2 pr-2">
                  <select value={fonte} onChange={(e) => setFonte(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest outline-none cursor-pointer"
                    style={{ background: fonte ? "#FFF8DC" : "#f9fafb", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                    <option value="">Fonte ▾</option>
                    {fontiList.map((f) => <option key={f}>{f}</option>)}
                  </select>
                </th>

                {/* Corriere dropdown-header */}
                <th className="py-2 pr-2">
                  <select value={corriere} onChange={(e) => setCorriere(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest outline-none cursor-pointer"
                    style={{ background: corriere ? "#FFF8DC" : "#f9fafb", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                    <option value="">Corriere ▾</option>
                    {corrieriList.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </th>

                {/* Magazzino dropdown-header */}
                <th className="py-2 pr-2">
                  <select value={magazzino} onChange={(e) => setMagazzino(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest outline-none cursor-pointer"
                    style={{ background: magazzino ? "#FFF8DC" : "#f9fafb", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                    <option value="">Magazzino ▾</option>
                    {magazzinoList.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </th>

                {/* Stato GLS dropdown-header */}
                <th className="py-2 pr-2">
                  <select value={statoGLS} onChange={(e) => setStatoGLS(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest outline-none cursor-pointer"
                    style={{ background: statoGLS ? "#FFF8DC" : "#f9fafb", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                    <option value="">Stato GLS ▾</option>
                    <option value="created">Creata</option>
                    <option value="closed">Chiusa</option>
                    <option value="deleted">Eliminata</option>
                  </select>
                </th>

                {/* Stato Magazzino dropdown-header */}
                <th className="py-2 pr-2">
                  <select value={statoMag} onChange={(e) => setStatoMag(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest outline-none cursor-pointer"
                    style={{ background: statoMag ? "#FFF8DC" : "#f9fafb", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                    <option value="">Stato Mag. ▾</option>
                    <option>In Preparazione</option>
                    <option>Annullato</option>
                    <option>Spedito</option>
                  </select>
                </th>

                {/* Actions col */}
                <th className="py-3 pr-4 w-20" />
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <RowSkeleton />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                    Nessuna spedizione trovata.
                  </td>
                </tr>
              ) : (
                filtered.map((r, idx) => {
                  const srcStyle   = SOURCE_COLORS[r.Source ?? ""]          ?? { bg: "#e5e7eb", color: "#374151" };
                  const glsStyle   = STATO_GLS_COLORS[r.status ?? ""]       ?? { bg: "#e5e7eb", color: "#374151" };
                  const magStyle   = STATO_MAG_COLORS[r.warehouseStatus ?? ""] ?? { bg: "#e5e7eb", color: "#374151" };
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
                          {r.parcelId ?? r.id.slice(0, 8).toUpperCase()}
                        </span>
                      </td>

                      {/* Ordine */}
                      <td className="py-3.5 pr-3">
                        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                          {r.orderId ?? "—"}
                        </span>
                      </td>

                      {/* Cliente */}
                      <td className="py-3.5 pr-3">
                        <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                          {r.destinationName ?? "—"}
                        </span>
                      </td>

                      {/* Creato Il */}
                      <td className="py-3.5 pr-3 whitespace-nowrap">
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          {formatDateTime(r.createdAt)}
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
                          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{r.sedeLabel}</span>
                        </div>
                      </td>

                      {/* Magazzino */}
                      <td className="py-3.5 pr-3">
                        <span className="text-xs" style={{ color: "var(--text-primary)" }}>{r.magazzinoLabel}</span>
                      </td>

                      {/* Stato GLS */}
                      <td className="py-3.5 pr-3">
                        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold"
                          style={{ background: glsStyle.bg, color: glsStyle.color }}>
                          {STATO_GLS_LABELS[r.status ?? ""] ?? r.status ?? "—"}
                        </span>
                      </td>

                      {/* Stato Magazzino */}
                      <td className="py-3.5 pr-3">
                        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold"
                          style={{ background: magStyle.bg, color: magStyle.color }}>
                          {r.warehouseStatus ?? "—"}
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
      </div>
    </div>
  );
}
