"use client";

import { useState, useEffect, useMemo } from "react";
import {
  collection, query, orderBy, getDocs, doc,
  addDoc, updateDoc, writeBatch, where, arrayUnion,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Search, Pencil, Plus, X, Check, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";

interface Disegno {
  id: string;
  Nome: string;
  Marca: string | DocumentReference | unknown;
  Stagione?: string;
  Immagine?: string;
  Conteggio?: number;
}

const CHAR_COLORS: Record<string, string> = {
  A: "#E31E24", B: "#003087", C: "#F7A600", D: "#009FE3", E: "#E30613",
  F: "#1A1A2E", G: "#CC0000", H: "#003366", I: "#E4002B", J: "#FF0000",
  K: "#FFCE00", L: "#0033A0", M: "#009FE3", N: "#E31E24", O: "#003087",
  P: "#E31E24", Q: "#F7A600", R: "#E30613", S: "#009FE3", T: "#003366",
  U: "#CC0000", V: "#E4002B", W: "#003087", X: "#1A1A2E", Y: "#FFCE00",
  Z: "#0033A0",
};

function accentFor(name: string): string {
  const key = (name ?? "")[0]?.toUpperCase();
  return CHAR_COLORS[key] ?? "#FFC803";
}

function resolveMarca(marca: Disegno["Marca"]): string {
  if (typeof marca === "string") return marca;
  if (marca && typeof marca === "object" && "id" in (marca as object))
    return (marca as DocumentReference).id;
  return "";
}

const PAGE_SIZE = 100;

function DisegnoSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden animate-pulse" style={{ border: "1px solid var(--border)" }}>
      <div style={{ height: 90, background: "var(--border)" }} />
      <div className="p-3 space-y-2">
        <div className="w-3/4 h-3 rounded-full" style={{ background: "var(--border)" }} />
        <div className="w-full h-6 rounded-full mt-1" style={{ background: "var(--border)" }} />
      </div>
    </div>
  );
}

export default function DisegniPage() {
  const [disegni, setDisegni] = useState<Disegno[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [stagioneFilter, setStagioneFilter] = useState("");
  const [page, setPage] = useState(0);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editDisegno, setEditDisegno] = useState<Disegno | null>(null);
  const [nomeInput, setNomeInput] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadDisegni() {
    try {
      const snap = await getDocs(query(collection(db, "Modello"), orderBy("Nome")));
      setDisegni(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Disegno, "id">) })));
    } catch {
      toast.error("Errore nel caricamento dei disegni");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadDisegni(); }, []);

  function openModal(disegno?: Disegno) {
    setEditDisegno(disegno ?? null);
    setNomeInput(disegno?.Nome ?? "");
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditDisegno(null);
    setNomeInput("");
  }

  async function handleSave() {
    const nome = nomeInput.trim();
    if (!nome) { toast.error("Inserisci il nome del disegno"); return; }
    setSaving(true);
    try {
      if (editDisegno) {
        const oldNome = editDisegno.Nome;
        const modelloRef = doc(db, "Modello", editDisegno.id);

        // 1. Update Modello: new Nome + old name appended to Sinonimo[]
        await updateDoc(modelloRef, {
          Nome: nome,
          Sinonimo: arrayUnion(oldNome),
        });

        // 2. Cascade: update all Prodotti with oldNome → newNome (batched, 400/batch)
        if (nome !== oldNome) {
          const prodSnap = await getDocs(
            query(collection(db, "Prodotti"), where("Modello", "==", oldNome))
          );
          const chunks: typeof prodSnap.docs[] = [];
          for (let i = 0; i < prodSnap.docs.length; i += 400) {
            chunks.push(prodSnap.docs.slice(i, i + 400));
          }
          for (const chunk of chunks) {
            const batch = writeBatch(db);
            chunk.forEach((pd) => batch.update(pd.ref, { Modello: nome }));
            await batch.commit();
          }
          toast.success(`Disegno aggiornato · ${prodSnap.docs.length} prodotti aggiornati`);
        } else {
          toast.success("Disegno aggiornato");
        }

        // Update local state
        setDisegni((prev) => prev.map((d) => d.id === editDisegno.id ? { ...d, Nome: nome } : d));
      } else {
        await addDoc(collection(db, "Modello"), { Nome: nome, Conteggio: 0, Sinonimo: [] });
        toast.success("Disegno aggiunto");
        setLoading(true);
        await loadDisegni();
      }
      closeModal();
    } catch (err) {
      console.error(err);
      toast.error("Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  }

  const uniqueBrands = useMemo(
    () => [...new Set(disegni.map((d) => resolveMarca(d.Marca)).filter(Boolean))].sort(),
    [disegni]
  );
  const uniqueStagioni = useMemo(
    () => [...new Set(disegni.map((d) => d.Stagione).filter(Boolean))].sort() as string[],
    [disegni]
  );

  const filtered = useMemo(() => {
    setPage(0);
    return disegni.filter((d) => {
      const marcaNome = resolveMarca(d.Marca);
      if (search && !d.Nome.toLowerCase().includes(search.toLowerCase())) return false;
      if (brandFilter && marcaNome !== brandFilter) return false;
      if (stagioneFilter && d.Stagione !== stagioneFilter) return false;
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disegni, search, brandFilter, stagioneFilter]);

  const paginated = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page]
  );
  const nbPages = Math.ceil(filtered.length / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Disegni</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "Caricamento…" : `${disegni.length} disegni/pattern in catalogo`}
          </p>
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold hover:opacity-80 transition-opacity"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
        >
          <Plus size={15} /> Aggiungi disegno
        </button>
      </div>

      <Card padding="sm">
        {/* Toolbar */}
        <div className="flex gap-2 mb-3 flex-wrap items-center">
          <div className="flex-1 min-w-48 relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              placeholder="Cerca per nome disegno…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl text-sm outline-none"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }}
            />
          </div>
          <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}
            className="px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
            <option value="">Tutti i brand</option>
            {uniqueBrands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={stagioneFilter} onChange={(e) => setStagioneFilter(e.target.value)}
            className="px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
            <option value="">Tutte le stagioni</option>
            {uniqueStagioni.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {(search || brandFilter || stagioneFilter) && (
            <button onClick={() => { setSearch(""); setBrandFilter(""); setStagioneFilter(""); }}
              className="p-2 rounded-xl"
              style={{ border: "1px solid var(--border)", background: "var(--bg-primary)" }}>
              <X size={13} style={{ color: "var(--text-secondary)" }} />
            </button>
          )}
          <span className="text-xs ml-auto flex-shrink-0" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
            {filtered.length.toLocaleString("it-IT")} risultati
          </span>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
          {loading
            ? Array.from({ length: 10 }).map((_, i) => <DisegnoSkeleton key={i} />)
            : paginated.map((d) => {
                const marcaNome = resolveMarca(d.Marca);
                const accent = accentFor(marcaNome || d.Nome);
                return (
                  <div key={d.id} className="rounded-2xl overflow-hidden"
                    style={{ border: "1px solid var(--border)", background: "var(--bg-primary)" }}>
                    {/* Image area */}
                    <div className="flex items-center justify-center" style={{ height: 90, background: "#F3F4F6" }}>
                      {d.Immagine ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={d.Immagine} alt={d.Nome} className="w-full h-full object-contain p-2"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white"
                          style={{ background: accent }}>
                          {(marcaNome || d.Nome)[0]}
                        </div>
                      )}
                    </div>
                    {/* Info */}
                    <div className="p-3">
                      <p className="font-semibold text-xs leading-tight mb-0.5 line-clamp-2"
                        style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                        {d.Nome}
                      </p>
                      <p className="text-[10px] mb-2" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                        {marcaNome || "—"}
                      </p>
                      <button
                        onClick={() => openModal(d)}
                        className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full w-full justify-center hover:bg-gray-50 transition-colors"
                        style={{ background: "#fff", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                        <Pencil size={10} /> Modifica
                      </button>
                    </div>
                  </div>
                );
              })}
        </div>

        {!loading && filtered.length === 0 && (
          <p className="text-center py-10 text-sm"
            style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
            Nessun disegno trovato{search ? ` per "${search}"` : ""}.
          </p>
        )}

        {/* Pagination */}
        {nbPages > 1 && (
          <div className="flex items-center justify-between mt-3 pt-3"
            style={{ borderTop: "1px solid var(--border)" }}>
            <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} di {filtered.length}
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => { setPage((p) => Math.max(0, p - 1)); window.scrollTo({ top: 0 }); }}
                disabled={page === 0}
                className="p-1.5 rounded-lg disabled:opacity-30"
                style={{ border: "1px solid var(--border)", background: "var(--bg-primary)" }}>
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs font-semibold px-2" style={{ fontFamily: "var(--font-montserrat)" }}>
                {page + 1} / {nbPages}
              </span>
              <button onClick={() => { setPage((p) => Math.min(nbPages - 1, p + 1)); window.scrollTo({ top: 0 }); }}
                disabled={page >= nbPages - 1}
                className="p-1.5 rounded-lg disabled:opacity-30"
                style={{ border: "1px solid var(--border)", background: "var(--bg-primary)" }}>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* ── Modal Aggiungi / Modifica Disegno ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="w-full max-w-sm rounded-2xl overflow-hidden"
            style={{ background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "1px solid #e5e7eb" }}>
              <h2 className="text-base font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
                {editDisegno ? "Modifica disegno" : "Nuovo disegno"}
              </h2>
              <button onClick={closeModal} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-5">
              <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                Nome disegno
              </label>
              <input
                type="text"
                value={nomeInput}
                onChange={(e) => setNomeInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                placeholder="es. Primacy 4"
                autoFocus
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)" }}
              />
              {editDisegno && nomeInput.trim() !== editDisegno.Nome && (
                <p className="mt-2 text-[11px]" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
                  Il vecchio nome &ldquo;{editDisegno.Nome}&rdquo; verrà aggiunto ai sinonimi e tutti i prodotti collegati verranno aggiornati.
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 flex justify-end gap-2"
              style={{ borderTop: "1px solid #e5e7eb" }}>
              <button onClick={closeModal}
                className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: "#f9fafb", border: "1px solid #e5e7eb", color: "#374151", fontFamily: "var(--font-montserrat)" }}>
                Annulla
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold hover:opacity-80 disabled:opacity-60 transition-opacity"
                style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {saving ? "Salvataggio…" : "Salva"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
