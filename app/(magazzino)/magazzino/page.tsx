"use client";

import { useState, useEffect } from "react";
import { collection, getDocs, getDoc, query, orderBy, addDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Package, Plus, ChevronDown, ChevronUp, QrCode, X } from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";
import type { Gabbia, LottoMagazzino } from "@/lib/types";
import type { DocumentReference } from "firebase/firestore";

type GabbiaUI = Gabbia & {
  sedeName: string;
  pzTotali: number;
};

async function resolveSede(ref: DocumentReference | undefined): Promise<string> {
  if (!ref) return "—";
  try {
    const snap = await getDoc(ref);
    return snap.exists() ? ((snap.data()?.Nome as string) ?? "—") : "—";
  } catch {
    return "—";
  }
}

function PosCoord({ label, value }: { label: string; value?: number }) {
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

function GabbiaCard({ g }: { g: GabbiaUI }) {
  const [expanded, setExpanded] = useState(false);
  const vuota = g.pzTotali === 0;

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
            {g.ID || g.id}
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
          {g.sedeName}
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
              {g.pzTotali}
            </span>
            <span className="text-[10px]" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>pz</span>
          </div>
        </div>

        {/* Lista prodotti espandibile */}
        {(g.Prodotti?.length ?? 0) > 0 && (
          <>
            <button
              onClick={(e) => { e.preventDefault(); setExpanded((v) => !v); }}
              className="flex items-center gap-1.5 text-xs font-semibold w-full"
              style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}
            >
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              Lista Pneumatici ({g.Prodotti!.length})
            </button>

            {expanded && (
              <div className="mt-2 space-y-1">
                {g.Prodotti!.map((lotto, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-3 py-1.5 rounded-lg text-xs"
                    style={{ background: "#f9fafb", fontFamily: "var(--font-montserrat)" }}
                  >
                    <span style={{ color: "#374151" }} className="truncate flex-1">
                      {lotto.Prodotto_Ref?.id ?? "—"}
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
  const [gabbie, setGabbie] = useState<GabbiaUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [sedi, setSedi] = useState<string[]>([]);
  const [sedeFilter, setSedeFilter] = useState("Tutte");
  const [showModal, setShowModal] = useState(false);
  const [nuova, setNuova] = useState<NuovaGabbiaForm>({ id: "", x: "0", y: "0", z: "0", sede: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDocs(query(collection(db, "Magazzino"), orderBy("ID")));
        const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Gabbia));

        // Risolvi le sedi in parallelo
        const sedeNames = await Promise.all(raw.map((g) => resolveSede(g.Sede)));

        const result: GabbiaUI[] = raw.map((g, i) => {
          const pzTotali =
            g.Prodotti?.reduce((sum, l) => sum + (l.Quantita ?? 0), 0) ??
            (g.Pneumatici_IN?.length ?? 0);
          return { ...g, sedeName: sedeNames[i], pzTotali };
        });

        setGabbie(result);
        const sediUniche = [...new Set(result.map((g) => g.sedeName).filter((s) => s !== "—"))];
        setSedi(sediUniche.sort());
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
    setSaving(true);
    try {
      await addDoc(collection(db, "Magazzino"), {
        ID: nuova.id.trim().toUpperCase(),
        X: parseInt(nuova.x) || 0,
        Y: parseInt(nuova.y) || 0,
        Z: parseInt(nuova.z) || 0,
        Prodotti: [],
      });
      toast.success(`Gabbia ${nuova.id.toUpperCase()} creata`);
      setShowModal(false);
      setNuova({ id: "", x: "0", y: "0", z: "0", sede: "" });
      // Reload
      setLoading(true);
      const snap = await getDocs(query(collection(db, "Magazzino"), orderBy("ID")));
      const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Gabbia));
      const sedeNames = await Promise.all(raw.map((g) => resolveSede(g.Sede)));
      setGabbie(raw.map((g, i) => ({
        ...g, sedeName: sedeNames[i],
        pzTotali: g.Prodotti?.reduce((s, l) => s + (l.Quantita ?? 0), 0) ?? 0,
      })));
    } catch (err) {
      console.error(err);
      toast.error("Errore nella creazione");
    } finally {
      setSaving(false);
      setLoading(false);
    }
  }

  const filtered = sedeFilter === "Tutte" ? gabbie : gabbie.filter((g) => g.sedeName === sedeFilter);
  const totalePneumatici = gabbie.reduce((s, g) => s + g.pzTotali, 0);
  const gabbieVuote = gabbie.filter((g) => g.pzTotali === 0).length;

  return (
    <div className="px-5 py-5 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
            Magazzino
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
            Gestione gabbie e stoccaggio pneumatici
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold"
          style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
        >
          <Plus size={16} /> Nuova gabbia
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "GABBIE TOTALI",       value: gabbie.length,    sub: "in magazzino",  color: "#FFF8DC" },
          { label: "PNEUMATICI STOCCATI", value: totalePneumatici, sub: "pezzi totali",  color: "#DCFCE7" },
          { label: "GABBIE VUOTE",        value: gabbieVuote,      sub: "disponibili",   color: "#FEE2E2" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-2xl p-4 flex items-center gap-4"
            style={{ background: "#fff", border: "1px solid #e5e7eb" }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: s.color }}
            >
              <Package size={22} style={{ color: "#111" }} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                {s.label}
              </p>
              <p className="text-2xl font-black" style={{ color: "#111", fontFamily: "var(--font-poppins)" }}>
                {loading ? "…" : s.value}
              </p>
              <p className="text-xs" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
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
              className="px-4 py-2 rounded-full text-xs font-semibold transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}>
          <div className="rounded-2xl p-6 w-full max-w-sm mx-4" style={{ background: "#fff" }}>
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
