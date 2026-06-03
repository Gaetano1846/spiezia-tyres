"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
  collection, query, orderBy, getDocs, doc,
  addDoc, updateDoc, writeBatch, where, arrayUnion,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { Search, Pencil, Plus, X, Check, Loader2, ChevronLeft, ChevronRight, Upload, ImageIcon } from "lucide-react";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";

interface Disegno {
  id: string;
  Nome: string;
  Immagine?: string;
  Conteggio?: number;
  conteggio?: number;  // alcune doc usano la variante minuscola
}

// Numero di prodotti che usano questo disegno (campo reale Conteggio / conteggio)
function conteggioOf(d: Disegno): number {
  return d.Conteggio ?? d.conteggio ?? 0;
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
  const [page, setPage] = useState(0);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editDisegno, setEditDisegno] = useState<Disegno | null>(null);
  const [nomeInput, setNomeInput] = useState("");
  const [immagineFile, setImmagineFile] = useState<File | null>(null);
  const [immaginePreview, setImmaginePreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setImmagineFile(null);
    setImmaginePreview(disegno?.Immagine ?? null);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditDisegno(null);
    setNomeInput("");
    setImmagineFile(null);
    setImmaginePreview(null);
  }

  function handleImmagineChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImmaginePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    setImmagineFile(file);
  }

  async function handleSave() {
    const nome = nomeInput.trim();
    if (!nome) { toast.error("Inserisci il nome del disegno"); return; }
    setSaving(true);
    try {
      // Upload immagine se presente
      let immagineUrl: string | undefined = editDisegno?.Immagine;
      if (immagineFile) {
        const ext = immagineFile.name.split(".").pop() ?? "png";
        const sRef = storageRef(storage, `disegni/${Date.now()}_${nome}.${ext}`);
        await uploadBytes(sRef, immagineFile, { contentType: immagineFile.type });
        immagineUrl = await getDownloadURL(sRef);
      } else if (!immaginePreview) {
        immagineUrl = undefined; // rimossa
      }

      if (editDisegno) {
        const oldNome = editDisegno.Nome;
        const modelloRef = doc(db, "Modello", editDisegno.id);

        const updatePayload: Record<string, unknown> = {
          Nome: nome,
          Sinonimo: arrayUnion(oldNome),
        };
        if (immagineUrl !== undefined) updatePayload.Immagine = immagineUrl;

        await updateDoc(modelloRef, updatePayload);

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

        setDisegni((prev) => prev.map((d) =>
          d.id === editDisegno.id ? { ...d, Nome: nome, Immagine: immagineUrl } : d
        ));
      } else {
        const payload: Record<string, unknown> = { Nome: nome, Conteggio: 0, Sinonimo: [] };
        if (immagineUrl) payload.Immagine = immagineUrl;
        await addDoc(collection(db, "Modello"), payload);
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

  const filtered = useMemo(() => {
    setPage(0);
    return disegni.filter((d) => {
      if (search && !d.Nome.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disegni, search]);

  const paginated = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page]
  );
  const nbPages = Math.ceil(filtered.length / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Disegni</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "Caricamento…" : `${disegni.length} disegni/pattern in catalogo`}
          </p>
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold hover:opacity-80 transition-all hover:brightness-[1.04] active:scale-[.98]"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}
        >
          <Plus size={15} /> Aggiungi disegno
        </button>
      </div>

      <Card padding="sm">
        {/* Toolbar */}
        <div className="flex gap-2 mb-3 flex-wrap items-center">
          <div className="flex-1 min-w-[150px] relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              placeholder="Cerca per nome disegno…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl text-sm outline-none"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }}
            />
          </div>
          {search && (
            <button onClick={() => setSearch("")}
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
                const accent = accentFor(d.Nome);
                const nProdotti = conteggioOf(d);
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
                          {d.Nome[0]}
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
                        {nProdotti} {nProdotti === 1 ? "prodotto" : "prodotti"}
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
            style={{ background: "#fff", boxShadow: "var(--shadow-xl)" }}>

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
            <div className="px-5 py-5 space-y-4">
              {/* Immagine */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-2"
                  style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                  Immagine disegno
                </label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden"
                    style={{ border: "1px solid #e5e7eb", background: "#f9fafb" }}>
                    {immaginePreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={immaginePreview} alt="preview" className="w-full h-full object-contain p-1" />
                    ) : (
                      <ImageIcon size={22} style={{ color: "#d1d5db" }} />
                    )}
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold w-full justify-center hover:opacity-80 transition-opacity"
                      style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#374151" }}>
                      <Upload size={14} />
                      {immagineFile ? immagineFile.name : "Carica immagine"}
                    </button>
                    {immaginePreview && (
                      <button type="button"
                        onClick={() => { setImmagineFile(null); setImmaginePreview(null); }}
                        className="flex items-center gap-1 text-xs w-full justify-center"
                        style={{ color: "#EF4444", fontFamily: "var(--font-montserrat)" }}>
                        <X size={11} /> Rimuovi immagine
                      </button>
                    )}
                    <p className="text-[10px] text-center" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                      PNG, JPG, WEBP — max 2 MB
                    </p>
                  </div>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={handleImmagineChange} />
              </div>

              {/* Nome */}
              <div>
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
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold hover:opacity-80 disabled:opacity-60 transition-all hover:brightness-[1.04] active:scale-[.98] disabled:active:scale-100"
                style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}>
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
