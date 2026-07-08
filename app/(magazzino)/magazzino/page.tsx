"use client";

import { useState, useEffect } from "react";
import { Package, Plus, ChevronDown, ChevronUp, QrCode, X } from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";
import type { GabbiaApi } from "@/lib/magazzinoDb";
import type { SimpleEntity } from "@/lib/lookupDb";

function PosCoord({ label, value }: { label: string; value?: number | null }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg px-2 py-1"
      style={{ border: "1px solid #e5e7eb", minWidth: 36 }}
    >
      <span className="text-[9px] font-bold uppercase" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
        {label}
      </span>
      <span className="text-sm font-black" style={{ color: "#111", fontFamily: "var(--font-poppins)" }}>
        {value ?? 0}
      </span>
    </div>
  );
}

function GabbiaCard({ g }: { g: GabbiaApi }) {
  const [expanded, setExpanded] = useState(false);
  const vuota = g.PzTotali === 0;

  return (
    <div
      className="rounded-2xl overflow-hidden transition-shadow hover:shadow-md"
      style={{ border: "1px solid #e5e7eb", background: "#fff" }}
    >
      {/* Header colorato */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ background: vuota ? "#f9fafb" : "#FFC803" }}
      >
        <div className="flex items-center gap-2">
          <QrCode size={16} style={{ color: vuota ? "#9ca3af" : "#111" }} />
          <span
            className="font-black text-sm"
            style={{ color: vuota ? "#374151" : "#111", fontFamily: "var(--font-poppins)" }}
          >
            {g.Codice || g.id}
          </span>
        </div>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{
            background: vuota ? "#e5e7eb" : "rgba(0,0,0,0.15)",
            color: vuota ? "#6b7280" : "#111",
            fontFamily: "var(--font-montserrat)",
          }}
        >
          {g.SedeNome}
        </span>
      </div>

      {/* Body */}
      <div className="p-4">
        {/* Coordinate X/Y/Z */}
        <div className="flex items-center gap-2 mb-3">
          <PosCoord label="X" value={g.X} />
          <PosCoord label="Y" value={g.Y} />
          <PosCoord label="Z" value={g.Z} />
          <div className="flex-1" />
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
            style={{ background: vuota ? "#f3f4f6" : "#FFF8DC", border: "1px solid #e5e7eb" }}
          >
            <Package size={13} style={{ color: vuota ? "#9ca3af" : "#111" }} />
            <span
              className="text-sm font-black"
              style={{ color: vuota ? "#9ca3af" : "#111", fontFamily: "var(--font-poppins)" }}
            >
              {g.PzTotali}
            </span>
            <span className="text-[10px]" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>pz</span>
          </div>
        </div>

        {/* Lista prodotti espandibile */}
        {g.Prodotti.length > 0 && (
          <>
            <button
              onClick={(e) => { e.preventDefault(); setExpanded((v) => !v); }}
              className="flex items-center gap-1.5 text-xs font-semibold w-full"
              style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}
            >
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              Lista Pneumatici ({g.Prodotti.length})
            </button>

            {expanded && (
              <div className="mt-2 space-y-1">
                {g.Prodotti.map((lotto, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-3 py-1.5 rounded-lg text-xs"
                    style={{ background: "#f9fafb", fontFamily: "var(--font-montserrat)" }}
                  >
                    <span style={{ color: "#374151" }} className="truncate flex-1">
                      {lotto.Marca || lotto.Modello ? `${lotto.Marca ?? ""} ${lotto.Modello ?? ""}`.trim() : (lotto.ProdottoId || "—")}
                    </span>
                    <span
                      className="font-bold ml-2 px-2 py-0.5 rounded-full"
                      style={{ background: "#FFC803", color: "#111", fontSize: 10 }}
                    >
                      ×{lotto.Quantita}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {vuota && (
          <p className="text-xs text-center mt-1" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
            Gabbia vuota
          </p>
        )}
      </div>

      {/* Footer link */}
      <Link
        href={`/magazzino/gabbie/${g.id}`}
        className="block text-center py-2 text-xs font-bold transition-colors hover:bg-[#FFF8DC]"
        style={{
          borderTop: "1px solid #f3f4f6",
          color: "#374151",
          fontFamily: "var(--font-montserrat)",
        }}
      >
        Apri →
      </Link>
    </div>
  );
}

type NuovaGabbiaForm = { id: string; x: string; y: string; z: string; sede: string };

export default function MagazzinoPage() {
  const [gabbie, setGabbie] = useState<GabbiaApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [sedi, setSedi] = useState<string[]>([]);
  const [sedeFilter, setSedeFilter] = useState("Tutte");
  const [showModal, setShowModal] = useState(false);
  const [nuova, setNuova] = useState<NuovaGabbiaForm>({ id: "", x: "0", y: "0", z: "0", sede: "" });
  const [sedeOptions, setSedeOptions] = useState<SimpleEntity[]>([]);
  const [saving, setSaving] = useState(false);

  async function loadGabbie() {
    const res = await fetch("/api/magazzino");
    if (!res.ok) throw new Error(String(res.status));
    const { gabbie: list } = await res.json();
    setGabbie(list);
    const sediUniche = [...new Set((list as GabbiaApi[]).map((g) => g.SedeNome).filter((s) => s !== "—"))];
    setSedi(sediUniche.sort());
  }

  useEffect(() => {
    async function load() {
      try {
        await loadGabbie();
        const sedeRes = await fetch("/api/lookup/sede");
        const { items } = await sedeRes.json();
        setSedeOptions(items ?? []);
      } catch (err) {
        console.error(err);
        toast.error("Errore nel caricamento del magazzino");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleCreaNuova() {
    if (!nuova.id.trim()) { toast.error("Inserisci un ID gabbia"); return; }
    // La sede è obbligatoria: senza, lo stock verrebbe mappato per default su Nola.
    if (!nuova.sede) { toast.error("Seleziona la sede della gabbia"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/magazzino", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codice: nuova.id.trim().toUpperCase(),
          x: parseInt(nuova.x) || 0,
          y: parseInt(nuova.y) || 0,
          z: parseInt(nuova.z) || 0,
          sedeId: nuova.sede,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));

      toast.success(`Gabbia ${nuova.id.toUpperCase()} creata`);
      setShowModal(false);
      setNuova({ id: "", x: "0", y: "0", z: "0", sede: "" });
      setLoading(true);
      await loadGabbie();
    } catch (err) {
      console.error(err);
      toast.error("Errore nella creazione");
    } finally {
      setSaving(false);
      setLoading(false);
    }
  }

  const filtered = sedeFilter === "Tutte" ? gabbie : gabbie.filter((g) => g.SedeNome === sedeFilter);
  const totalePneumatici = gabbie.reduce((s, g) => s + g.PzTotali, 0);
  const gabbieVuote = gabbie.filter((g) => g.PzTotali === 0).length;

  return (
    <div className="px-4 md:px-5 py-4 sm:py-5 space-y-4 sm:space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
            Magazzino
          </h1>
          <p className="text-xs sm:text-sm mt-0.5" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
            Gestione gabbie e stoccaggio pneumatici
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold flex-shrink-0"
          style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
        >
          <Plus size={16} /> <span className="hidden sm:inline">Nuova gabbia</span><span className="sm:hidden">Nuova</span>
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { label: "GABBIE TOTALI",       value: gabbie.length,    sub: "in magazzino",  color: "#FFF8DC" },
          { label: "PNEUMATICI STOCCATI", value: totalePneumatici, sub: "pezzi totali",  color: "#DCFCE7" },
          { label: "GABBIE VUOTE",        value: gabbieVuote,      sub: "disponibili",   color: "#FEE2E2" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-2xl p-3 sm:p-4 flex flex-col items-center text-center gap-1.5 sm:flex-row sm:items-center sm:text-left sm:gap-3"
            style={{ background: "#fff", border: "1px solid #e5e7eb" }}
          >
            <div
              className="w-9 h-9 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: s.color }}
            >
              <Package className="w-[18px] h-[18px] sm:w-[22px] sm:h-[22px]" style={{ color: "#111" }} />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wide sm:tracking-widest leading-tight" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                {s.label}
              </p>
              <p className="text-xl sm:text-2xl font-black leading-tight" style={{ color: "#111", fontFamily: "var(--font-poppins)" }}>
                {loading ? "…" : s.value}
              </p>
              <p className="hidden sm:block text-xs" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                {s.sub}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter sede */}
      {sedi.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          {["Tutte", ...sedi].map((s) => (
            <button
              key={s}
              onClick={() => setSedeFilter(s)}
              className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs font-semibold transition-colors flex-shrink-0"
              style={{
                background: sedeFilter === s ? "#FFC803" : "#fff",
                border: "1px solid #e5e7eb",
                color: "#111",
                fontFamily: "var(--font-montserrat)",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Modal nuova gabbia */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}>
          <div className="rounded-2xl p-6 w-full max-w-sm" style={{ background: "#fff" }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>Nuova gabbia</h3>
              <button onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="space-y-3">
              {[
                { label: "ID gabbia *", key: "id", placeholder: "es. A-01" },
                { label: "X", key: "x", placeholder: "0" },
                { label: "Y", key: "y", placeholder: "0" },
                { label: "Z", key: "z", placeholder: "0" },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold mb-1" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>{label}</label>
                  <input
                    type="text"
                    value={nuova[key as keyof NuovaGabbiaForm]}
                    onChange={(e) => setNuova((n) => ({ ...n, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                    style={{ border: "1px solid #e5e7eb", background: "#f9fafb", fontFamily: "var(--font-montserrat)" }}
                  />
                </div>
              ))}
              {/* Sede (obbligatoria: determina la mappatura dello stock per deposito) */}
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>Sede *</label>
                <select
                  value={nuova.sede}
                  onChange={(e) => setNuova((n) => ({ ...n, sede: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ border: "1px solid #e5e7eb", background: "#f9fafb", fontFamily: "var(--font-montserrat)" }}
                >
                  <option value="">Seleziona sede…</option>
                  {sedeOptions.map((s) => (
                    <option key={s.id} value={s.id}>{s.Nome}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ border: "1px solid #e5e7eb", color: "#374151", fontFamily: "var(--font-montserrat)" }}
              >
                Annulla
              </button>
              <button
                onClick={handleCreaNuova}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold disabled:opacity-60"
                style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                {saving ? "Salvo…" : "Crea"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Griglia gabbie */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-2xl h-40 animate-pulse"
              style={{ background: "#fff", border: "1px solid #e5e7eb" }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Package size={48} style={{ color: "#d1d5db" }} />
          <p className="text-base font-semibold" style={{ color: "#374151", fontFamily: "var(--font-poppins)" }}>
            Nessuna gabbia trovata
          </p>
          <p className="text-sm" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
            Premi "+ Nuova gabbia" per aggiungere la prima posizione
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((g) => (
            <GabbiaCard key={g.id} g={g} />
          ))}
        </div>
      )}
    </div>
  );
}
