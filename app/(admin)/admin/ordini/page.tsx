"use client";

import { useState, useEffect, useMemo } from "react";
import {
  collection, query, orderBy, getDocs, getDoc, getCountFromServer,
  where, limit, onSnapshot, doc,
  type DocumentReference, type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ShoppingBag, Search, X, Eye, Truck, Download, Check, MapPin, RefreshCw, Package2 } from "lucide-react";
import Link from "next/link";
import Badge from "@/components/ui/Badge";
import toast from "react-hot-toast";
import type { Ordine, OrdineStato, OrdineSource } from "@/lib/types";

// ─── Constants ─────────────────────────────────────────────────────────────────

const STATI: OrdineStato[] = [
  "In attesa di pagamento", "Confermato", "In lavorazione",
  "Spedito", "Consegnato", "Annullato", "Rimborsato",
];

const FONTI = ["B2B", "eBay", "Amazon", "WooCommerce", "T24", "Prezzo-Gomme", "AdTyres", "Anonimo"];

const FONTE_COLORS: Record<string, { bg: string; text: string }> = {
  B2B:            { bg: "#FFC803", text: "#111" },
  eBay:           { bg: "#92C821", text: "#fff" },
  Amazon:         { bg: "#2196F3", text: "#fff" },
  WooCommerce:    { bg: "#7F54B3", text: "#fff" },
  T24:            { bg: "#EC7522", text: "#fff" },
  "Prezzo-Gomme": { bg: "#1565C0", text: "#fff" },
  AdTyres:        { bg: "#E8E8E8", text: "#374151" },
  Anonimo:        { bg: "#E8E8E8", text: "#374151" },
};

const STATO_VARIANT: Record<string, "success" | "brand" | "neutral" | "error" | "warning"> = {
  "Confermato":             "brand",
  "In lavorazione":         "warning",
  "Spedito":                "brand",
  "Consegnato":             "success",
  "In attesa di pagamento": "neutral",
  "Annullato":              "error",
  "Rimborsato":             "error",
};

// ─── Types ─────────────────────────────────────────────────────────────────────

type OrdineEntry = { ordine: Ordine; clienteNome: string; docId: string };

type KPIs = { totale: number; daEvadere: number; inTransito: number; annullati: number };

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function batchGetDocs(refs: DocumentReference[]): Promise<Map<string, Record<string, unknown>>> {
  if (refs.length === 0) return new Map();
  const unique = [...new Map(refs.map((r) => [r.path, r])).values()];
  const snaps = await Promise.all(unique.map((r) => getDoc(r)));
  const map = new Map<string, Record<string, unknown>>();
  snaps.forEach((s) => {
    if (s.exists()) map.set(s.ref.path, { id: s.id, ...s.data() } as Record<string, unknown>);
  });
  return map;
}

// Prova tutti i nomi di campo timestamp usati da Flutter/FlutterFlow
function getTs(ordine: Ordine): Timestamp | undefined {
  const o = ordine as unknown as Record<string, Timestamp>;
  return o.DataOra ?? o.dataOra ?? o.data_ora ?? o.DataCreazione ?? o.createdAt ?? o.created_time;
}

function formatData(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "—";
  const d = ts.toDate();
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" })
    + " " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function toISODate(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "";
  const d = ts.toDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatEuro(n: number | undefined | null) {
  if (n == null) return "—";
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

// ─── SpedizioneModal ───────────────────────────────────────────────────────────

type Spedizione = {
  id: string;
  corriere?: string;
  parcelId?: string;
  destinationName?: string;
  warehouseStatus?: string;
  contractIndex?: number;
  motivoAnnullamento?: string;
  noteAggiuntive?: string;
};

const WAREHOUSE_STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  "In Preparazione": { bg: "#FFF8DC", text: "#B45309" },
  "Spedito":         { bg: "#DCFCE7", text: "#166534" },
  "Annullato":       { bg: "#FEE2E2", text: "#991B1B" },
};

function SpedizioneModal({ docId, orderId, onClose }: { docId: string; orderId: string; onClose: () => void }) {
  const [spedizioni, setSpedizioni] = useState<Spedizione[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, "Ordini", docId);
    const q = query(
      collection(db, "Spedizioni"),
      where("orderReference", "==", ref),
      orderBy("createdAt", "desc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setSpedizioni(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Spedizione)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [docId]);

  const SEDE = ["Nola", "Roma"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full overflow-hidden"
        style={{ maxWidth: 520, fontFamily: "var(--font-montserrat)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #f3f4f6" }}>
          <div className="flex items-center gap-2.5">
            <Truck size={18} style={{ color: "#FFC803" }} />
            <div>
              <h2 className="text-sm font-bold" style={{ color: "#111", fontFamily: "var(--font-poppins)" }}>
                Spedizioni
              </h2>
              <p className="text-xs" style={{ color: "#9ca3af" }}>Ordine {orderId}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors">
            <X size={18} style={{ color: "#374151" }} />
          </button>
        </div>

        {/* Contenuto */}
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "#f3f4f6" }} />
              ))}
            </div>
          ) : spedizioni.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <Package2 size={36} style={{ color: "#d1d5db" }} />
              <p className="text-sm font-semibold" style={{ color: "#374151" }}>Nessuna spedizione</p>
              <p className="text-xs" style={{ color: "#9ca3af" }}>Non ci sono spedizioni associate a questo ordine</p>
            </div>
          ) : (
            <div className="space-y-3">
              {spedizioni.map((s) => {
                const statusStyle = WAREHOUSE_STATUS_STYLE[s.warehouseStatus ?? ""] ?? { bg: "#f3f4f6", text: "#374151" };
                return (
                  <div key={s.id} className="rounded-xl p-3.5" style={{ border: "1px solid #e5e7eb" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Corriere badge */}
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-bold"
                          style={{ background: s.corriere === "GLS" ? "#003DA5" : "#E8001C", color: "#fff" }}
                        >
                          {s.corriere ?? "—"}
                        </span>
                        {/* Sede */}
                        {s.corriere === "GLS" && s.contractIndex != null && (
                          <span className="text-xs font-semibold" style={{ color: "#6b7280" }}>
                            {SEDE[s.contractIndex] ?? `Sede ${s.contractIndex}`}
                          </span>
                        )}
                        {/* Stato */}
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ background: statusStyle.bg, color: statusStyle.text }}
                        >
                          {s.warehouseStatus ?? "—"}
                        </span>
                      </div>
                    </div>

                    {/* Parcel ID */}
                    {s.parcelId && (
                      <p className="mt-2 text-sm font-bold font-mono" style={{ color: "#111" }}>
                        {s.parcelId}
                      </p>
                    )}

                    {/* Destinazione */}
                    {s.destinationName && (
                      <p className="mt-1 text-xs" style={{ color: "#6b7280" }}>
                        <MapPin size={10} className="inline mr-1" />
                        {s.destinationName}
                      </p>
                    )}

                    {/* Motivo annullamento */}
                    {s.motivoAnnullamento && (
                      <p className="mt-1.5 text-xs px-2 py-1 rounded-lg" style={{ background: "#FEE2E2", color: "#991B1B" }}>
                        {s.motivoAnnullamento}
                      </p>
                    )}

                    {/* Note */}
                    {s.noteAggiuntive && (
                      <p className="mt-1 text-xs" style={{ color: "#9ca3af" }}>{s.noteAggiuntive}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function OrdiniAdminPage() {
  const [entries, setEntries] = useState<OrdineEntry[]>([]);
  const [kpis, setKpis]       = useState<KPIs | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters — always visible (like Flutter)
  const [search, setSearch]       = useState("");
  const [stato, setStato]         = useState<OrdineStato | "">("");
  const [fonte, setFonte]         = useState("");
  const [dataDa, setDataDa]       = useState("");
  const [dataA, setDataA]         = useState("");

  // Multi-selezione
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal spedizioni
  const [spedizioneModal, setSpedizioneModal] = useState<{ docId: string; orderId: string } | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [ordiniSnap, kpiTotale, kpiDaEvadere, kpiTransito, kpiAnnullati] = await Promise.all([
          getDocs(query(collection(db, "Ordini"), orderBy("DataOra", "desc"), limit(300))),
          getCountFromServer(collection(db, "Ordini")),
          getCountFromServer(query(collection(db, "Ordini"), where("Stato", "in", ["Confermato", "In lavorazione"]))),
          getCountFromServer(query(collection(db, "Ordini"), where("Stato", "==", "Spedito"))),
          getCountFromServer(query(collection(db, "Ordini"), where("Stato", "==", "Annullato"))),
        ]);

        setKpis({
          totale:     kpiTotale.data().count,
          daEvadere:  kpiDaEvadere.data().count,
          inTransito: kpiTransito.data().count,
          annullati:  kpiAnnullati.data().count,
        });

        const ordini = ordiniSnap.docs
          .map((d) => ({ docId: d.id, ordine: { ...d.data(), id: (d.data() as Record<string, unknown>).id ?? d.id } as Ordine }))
          .sort((a, b) => (getTs(b.ordine)?.toMillis() ?? 0) - (getTs(a.ordine)?.toMillis() ?? 0));

        const clienteRefs = ordini.map(({ ordine: o }) => o.Cliente).filter(Boolean) as DocumentReference[];
        const utenteRefs  = ordini.map(({ ordine: o }) => o.Utente).filter(Boolean) as DocumentReference[];
        const [clientiMap, utentiMap] = await Promise.all([
          batchGetDocs(clienteRefs),
          batchGetDocs(utenteRefs),
        ]);

        const resolved: OrdineEntry[] = ordini.map(({ ordine, docId }) => {
          let clienteNome = "—";
          if (ordine.Cliente) {
            const c = clientiMap.get(ordine.Cliente.path);
            if (c) clienteNome = String(c.Ragione_Sociale || c.Nome || "").trim() || String(c.Azienda || "").trim() || "—";
          } else if (ordine.Utente) {
            const u = utentiMap.get(ordine.Utente.path);
            if (u) clienteNome = String(u.displayName || u.email || "—");
          }
          return { ordine, clienteNome, docId };
        });

        setEntries(resolved);
      } catch (e) {
        toast.error("Errore nel caricamento ordini");
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return entries.filter(({ ordine, clienteNome }) => {
      if (search) {
        const hay = [ordine.id, clienteNome, String(ordine.Totale ?? "")].join(" ").toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      if (stato  && ordine.Stato  !== stato)  return false;
      if (fonte  && ordine.Source !== fonte)  return false;
      const iso = toISODate(getTs(ordine));
      if (dataDa && iso < dataDa) return false;
      if (dataA  && iso > dataA)  return false;
      return true;
    });
  }, [entries, search, stato, fonte, dataDa, dataA]);

  function reset() {
    setSearch(""); setStato(""); setFonte(""); setDataDa(""); setDataA("");
  }

  const hasFilters = !!(stato || fonte || dataDa || dataA || search);

  // ── Selezione ──────────────────────────────────────────────────────────────
  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(filtered.map((e) => e.docId)));
  }

  function handleExportSelected() {
    const rows = filtered.filter((e) => selectedIds.has(e.docId));
    const header = ["ID", "Cliente", "Fonte", "Stato", "Totale", "Data"];
    const lines = rows.map(({ ordine, clienteNome }) => [
      ordine.id ?? "",
      clienteNome,
      ordine.Source ?? "",
      ordine.Stato ?? "",
      String(ordine.Totale ?? ""),
      formatData(getTs(ordine)),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ordini_selezionati_${rows.length}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Esportati ${rows.length} ordini`);
  }

  function handleSpedisci(sede: "Roma" | "Nola") {
    toast(`Spedizione ${sede}: integrazione CF in arrivo (${selectedIds.size} ordini)`);
  }

  function handleAggiornaTracking() {
    toast(`Aggiorna Tracking: integrazione CF in arrivo (${selectedIds.size} ordini)`);
  }

  // ── KPI cards ──────────────────────────────────────────────────────────────
  const kpiCards = [
    { label: "Totale ordini",  value: kpis?.totale    ?? 0, accent: "#FFC803" },
    { label: "Da evadere",     value: kpis?.daEvadere  ?? 0, accent: "#EE8B60" },
    { label: "In transito",    value: kpis?.inTransito ?? 0, accent: "#249689" },
    { label: "Annullati",      value: kpis?.annullati  ?? 0, accent: "#FF5963" },
  ];

  return (
    <div className="px-5 py-5 space-y-6">

      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
              Ordini
            </h1>
            <p className="text-sm mt-0.5" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
              Tutti i canali: B2B, eBay, Amazon, WooCommerce
            </p>
          </div>
          <a
            href="/api/admin/ordini/export"
            download
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors hover:bg-[#FFF8DC]"
            style={{ border: "1px solid #FFC803", color: "#111", fontFamily: "var(--font-montserrat)", background: "#fff" }}
          >
            <Download size={15} /> Esporta CSV
          </a>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpiCards.map(({ label, value, accent }) => (
          <div
            key={label}
            className="rounded-2xl p-5"
            style={{ background: "#fff", border: "1px solid #e5e7eb" }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                {label}
              </span>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${accent}22` }}>
                <ShoppingBag size={14} style={{ color: accent }} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-14 rounded animate-pulse" style={{ background: "#f3f4f6" }} />
            ) : (
              <p className="text-3xl font-black" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
                {value}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Filters + table card */}
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #e5e7eb", background: "#fff" }}>

        {/* Search bar */}
        <div className="px-4 pt-4 pb-3" style={{ borderBottom: "1px solid #f3f4f6" }}>
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "#9ca3af" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per numero, cliente, importo..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none"
              style={{
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                fontFamily: "var(--font-montserrat)",
                color: "#111",
              }}
            />
          </div>
        </div>

        {/* Filter row — always visible */}
        <div className="flex items-center gap-2.5 flex-wrap px-4 py-3" style={{ borderBottom: "1px solid #f3f4f6" }}>
          {/* Stato */}
          <select
            value={stato}
            onChange={(e) => setStato(e.target.value as OrdineStato | "")}
            className="px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#374151" }}
          >
            <option value="">Tutti gli stati</option>
            {STATI.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Fonte */}
          <select
            value={fonte}
            onChange={(e) => setFonte(e.target.value)}
            className="px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#374151" }}
          >
            <option value="">Tutte le fonti</option>
            {FONTI.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>

          {/* Data da */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>Dal</span>
            <input
              type="date"
              value={dataDa}
              onChange={(e) => setDataDa(e.target.value)}
              className="px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#374151" }}
            />
          </div>

          {/* Data a */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>Al</span>
            <input
              type="date"
              value={dataA}
              onChange={(e) => setDataA(e.target.value)}
              className="px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#374151" }}
            />
          </div>

          {hasFilters && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold"
              style={{ background: "#FEE2E2", border: "1px solid #FECACA", color: "#991B1B", fontFamily: "var(--font-montserrat)" }}
            >
              <X size={13} /> Azzera filtri
            </button>
          )}
        </div>

        {/* Barra azioni bulk — visibile solo con selezione attiva */}
        {selectedIds.size > 0 && (
          <div
            className="flex items-center gap-2.5 px-4 py-2.5 flex-wrap"
            style={{ background: "#FFFDF0", borderBottom: "1px solid #FFC803" }}
          >
            <span className="text-xs font-bold mr-1" style={{ color: "#111", fontFamily: "var(--font-montserrat)" }}>
              {selectedIds.size} selezionat{selectedIds.size === 1 ? "o" : "i"}
            </span>
            <button
              onClick={handleExportSelected}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors hover:bg-[#f9fafb]"
              style={{ border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontFamily: "var(--font-montserrat)" }}
            >
              <Download size={12} /> Export CSV
            </button>
            <button
              onClick={() => handleSpedisci("Roma")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors hover:bg-[#f9fafb]"
              style={{ border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontFamily: "var(--font-montserrat)" }}
            >
              <MapPin size={12} /> Spedisci Roma
            </button>
            <button
              onClick={() => handleSpedisci("Nola")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors hover:bg-[#f9fafb]"
              style={{ border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontFamily: "var(--font-montserrat)" }}
            >
              <MapPin size={12} /> Spedisci Nola
            </button>
            <button
              onClick={handleAggiornaTracking}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors hover:bg-[#f9fafb]"
              style={{ border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontFamily: "var(--font-montserrat)" }}
            >
              <RefreshCw size={12} /> Aggiorna Tracking
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold ml-auto"
              style={{ background: "#fee2e2", color: "#ef4444", fontFamily: "var(--font-montserrat)" }}
            >
              <X size={11} /> Deseleziona
            </button>
          </div>
        )}

        {/* Count */}
        <div className="px-4 py-2" style={{ borderBottom: "1px solid #f3f4f6" }}>
          <p className="text-xs" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "Caricamento…" : `${filtered.length} di ${entries.length} ordini`}
          </p>
        </div>

        {/* Table */}
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-11 rounded-xl animate-pulse" style={{ background: "#f3f4f6" }} />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                  {/* Select-all checkbox */}
                  <th className="pl-4 pr-2 py-3 w-10">
                    <button
                      onClick={toggleSelectAll}
                      className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
                      style={{
                        background: allSelected ? "#FFC803" : someSelected ? "#FFF8DC" : "#fff",
                        border: `1.5px solid ${(allSelected || someSelected) ? "#FFC803" : "#d1d5db"}`,
                      }}
                    >
                      {allSelected && <Check size={13} style={{ color: "#111" }} />}
                      {someSelected && <div style={{ width: 8, height: 2, background: "#FFC803", borderRadius: 1 }} />}
                    </button>
                  </th>
                  {["ID Ordine", "Cliente", "Data", "Fonte", "Importo", "Stato", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: "#9ca3af" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-14 text-center text-sm" style={{ color: "#9ca3af" }}>
                      Nessun ordine trovato.
                    </td>
                  </tr>
                ) : (
                  filtered.map(({ ordine, clienteNome, docId }) => {
                    const isSelected = selectedIds.has(docId);
                    return (
                    <tr
                      key={docId}
                      className="hover:bg-[#FFFDF0] transition-colors"
                      style={{ borderBottom: "1px solid #f3f4f6", background: isSelected ? "#FFFDF0" : undefined }}
                    >
                      {/* Checkbox */}
                      <td className="pl-4 pr-2 py-3.5 w-10">
                        <button
                          onClick={() => toggleSelect(docId)}
                          className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
                          style={{
                            background: isSelected ? "#FFC803" : "#fff",
                            border: `1.5px solid ${isSelected ? "#FFC803" : "#d1d5db"}`,
                          }}
                        >
                          {isSelected && <Check size={13} style={{ color: "#111" }} />}
                        </button>
                      </td>

                      {/* ID */}
                      <td className="px-4 py-3.5 font-semibold" style={{ color: "#111" }}>
                        {ordine.id}
                      </td>

                      {/* Cliente */}
                      <td className="px-4 py-3.5 max-w-[180px] truncate" style={{ color: "#374151" }}>
                        {clienteNome}
                      </td>

                      {/* Data */}
                      <td className="px-4 py-3.5 text-xs whitespace-nowrap" style={{ color: "#6b7280" }}>
                        {formatData(getTs(ordine))}
                      </td>

                      {/* Fonte */}
                      <td className="px-4 py-3.5">
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-bold"
                          style={{
                            background: FONTE_COLORS[ordine.Source]?.bg ?? "#E8E8E8",
                            color: FONTE_COLORS[ordine.Source]?.text ?? "#374151",
                          }}
                        >
                          {ordine.Source}
                        </span>
                      </td>

                      {/* Importo */}
                      <td className="px-4 py-3.5 font-bold" style={{ color: "#111" }}>
                        {formatEuro(ordine.Totale)}
                      </td>

                      {/* Stato */}
                      <td className="px-4 py-3.5">
                        <Badge variant={STATO_VARIANT[ordine.Stato] ?? "neutral"}>
                          {ordine.Stato}
                        </Badge>
                      </td>

                      {/* Azioni */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/admin/ordini/${docId}`}
                            className="p-1.5 rounded-lg hover:bg-[#FFF8DC] transition-colors"
                            title="Dettagli ordine"
                          >
                            <Eye size={15} style={{ color: "#374151" }} />
                          </Link>
                          <button
                            className="p-1.5 rounded-lg hover:bg-[#f3f4f6] transition-colors"
                            title="Spedizioni ordine"
                            onClick={() => setSpedizioneModal({ docId, orderId: ordine.id ?? docId })}
                          >
                            <Truck size={15} style={{ color: "#374151" }} />
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
        )}
      </div>

      {spedizioneModal && (
        <SpedizioneModal
          docId={spedizioneModal.docId}
          orderId={spedizioneModal.orderId}
          onClose={() => setSpedizioneModal(null)}
        />
      )}
    </div>
  );
}
