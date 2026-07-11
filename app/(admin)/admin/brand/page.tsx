"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { Search, Pencil, Trash2, Plus, X, Check, Loader2, Upload, ImageIcon } from "lucide-react";
import Card from "@/components/ui/Card";
import InfiniteScrollSentinel from "@/components/ui/InfiniteScrollSentinel";
import toast from "react-hot-toast";
import { useFirestoreInfiniteList } from "@/hooks/useFirestoreInfiniteList";

interface Brand {
  id: string;
  Nome: string;
  Colore?: string;
  Logo?: string;
  conteggio?: number;
}

const CHAR_COLORS: Record<string, string> = {
  A: "#E31E24", B: "#003087", C: "#F7A600", D: "#009FE3", E: "#E30613",
  F: "#1A1A2E", G: "#CC0000", H: "#003366", I: "#E4002B", J: "#FF0000",
  K: "#FFCE00", L: "#0033A0", M: "#009FE3", N: "#E31E24", O: "#003087",
  P: "#E31E24", Q: "#F7A600", R: "#E30613", S: "#009FE3", T: "#003366",
  U: "#CC0000", V: "#E4002B", W: "#003087", X: "#1A1A2E", Y: "#FFCE00",
  Z: "#0033A0",
};

function accentFor(nome: string, colore?: string): string {
  if (colore) return colore;
  const key = nome[0]?.toUpperCase();
  return CHAR_COLORS[key] ?? "#FFC803";
}

function BrandSkeleton() {
  return (
    <div className="rounded-2xl p-4 flex flex-col items-center gap-2.5 animate-pulse"
      style={{ border: "1px solid var(--border)", background: "var(--bg-primary)" }}>
      <div className="w-14 h-14 rounded-xl" style={{ background: "var(--border)" }} />
      <div className="w-16 h-3 rounded-full" style={{ background: "var(--border)" }} />
      <div className="w-full h-7 rounded-full" style={{ background: "var(--border)" }} />
    </div>
  );
}

type FormState = { nome: string; logoFile: File | null; logoPreview: string | null };
const FORM_DEFAULT: FormState = { nome: "", logoFile: null, logoPreview: null };

export default function BrandPage() {
  const {
    items: brands,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    loadAll,
    reload: reloadBrands,
    mutate: mutateBrands,
    epoch: brandsEpoch,
  } = useFirestoreInfiniteList<Brand>({
    collectionPath: "Marca_Prodotto",
    orderByField: "Nome",
    pageSize: 100,
    mapDoc: useCallback((id, data) => ({ id, ...data }) as Brand, []),
  });
  const [search, setSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editBrand, setEditBrand] = useState<Brand | null>(null);
  const [form, setForm] = useState<FormState>(FORM_DEFAULT);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ricerca attiva → serve l'intera collezione, non solo la pagina già caricata.
  useEffect(() => {
    if (search.trim()) loadAll();
  }, [search, loadAll, brandsEpoch]);

  function openModal(brand?: Brand) {
    setEditBrand(brand ?? null);
    setForm(brand
      ? { nome: brand.Nome, logoFile: null, logoPreview: brand.Logo ?? null }
      : FORM_DEFAULT
    );
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditBrand(null);
    setForm(FORM_DEFAULT);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setForm((f) => ({
      ...f, logoFile: file, logoPreview: ev.target?.result as string,
    }));
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    if (!form.nome.trim()) { toast.error("Inserisci il nome del brand"); return; }
    setSaving(true);
    try {
      let logoUrl: string | undefined = editBrand?.Logo;

      if (form.logoFile) {
        const ext = form.logoFile.name.split(".").pop() ?? "png";
        const storageRef = ref(storage, `brand_logos/${Date.now()}_${form.nome.trim()}.${ext}`);
        await uploadBytes(storageRef, form.logoFile, { contentType: form.logoFile.type });
        logoUrl = await getDownloadURL(storageRef);
      }

      const payload: Record<string, unknown> = { Nome: form.nome.trim() };
      if (logoUrl) payload.Logo = logoUrl;

      if (editBrand) {
        await updateDoc(doc(db, "Marca_Prodotto", editBrand.id), payload);
        mutateBrands((prev) => prev.map((b) => (b.id === editBrand.id ? { ...b, ...payload } as Brand : b)));
        toast.success("Brand aggiornato");
      } else {
        await addDoc(collection(db, "Marca_Prodotto"), { ...payload, conteggio: 0 });
        toast.success("Brand aggiunto");
        reloadBrands();
      }

      closeModal();
    } catch (err) {
      console.error(err);
      toast.error("Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(brand: Brand) {
    if (!confirm(`Eliminare il brand "${brand.Nome}"?`)) return;
    try {
      await deleteDoc(doc(db, "Marca_Prodotto", brand.id));
      mutateBrands((prev) => prev.filter((b) => b.id !== brand.id));
      closeModal();
      toast.success("Brand eliminato");
    } catch {
      toast.error("Errore nell'eliminazione del brand");
    }
  }

  const filtered = brands.filter((b) =>
    b.Nome?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Brand</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "Caricamento…" : `${brands.length}${hasMore ? "+" : ""} marche in catalogo`}
          </p>
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold hover:opacity-80 transition-all hover:brightness-[1.04] active:scale-[.98]"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}
        >
          <Plus size={15} /> Aggiungi brand
        </button>
      </div>

      <Card padding="sm">
        {/* Search */}
        <div className="relative mb-4 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
          <input
            placeholder="Cerca brand…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl text-sm outline-none"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }}
          />
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
          {loading
            ? Array.from({ length: 10 }).map((_, i) => <BrandSkeleton key={i} />)
            : filtered.map((b) => {
                const accent = accentFor(b.Nome, b.Colore);
                return (
                  <div key={b.id}
                    className="rounded-2xl p-4 flex flex-col items-center gap-2.5"
                    style={{ border: "1px solid var(--border)", background: "var(--bg-primary)" }}>
                    {b.Logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.Logo} alt={b.Nome}
                        className="w-14 h-14 rounded-xl object-contain"
                        style={{ background: accent + "22", padding: 6 }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <div className="w-14 h-14 rounded-xl flex items-center justify-center text-xl font-bold text-white"
                        style={{ background: accent }}>
                        {b.Nome[0]}
                      </div>
                    )}
                    <p className="font-semibold text-xs text-center leading-tight"
                      style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                      {b.Nome}
                    </p>
                    <button
                      onClick={() => openModal(b)}
                      className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full w-full justify-center hover:bg-gray-50 transition-colors"
                      style={{ background: "#fff", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                      <Pencil size={10} /> Modifica
                    </button>
                  </div>
                );
              })}
        </div>

        {!loading && filtered.length === 0 && (
          <p className="text-center py-10 text-sm"
            style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
            Nessun brand trovato per &ldquo;{search}&rdquo;
          </p>
        )}

        {!loading && (
          <InfiniteScrollSentinel onVisible={loadMore} hasMore={hasMore} loading={loadingMore} />
        )}
      </Card>

      {/* ── Modal Aggiungi / Modifica Brand ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden"
            style={{ background: "#fff", boxShadow: "var(--shadow-xl)" }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "1px solid #e5e7eb" }}>
              <h2 className="text-base font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
                {editBrand ? "Modifica brand" : "Nuovo brand"}
              </h2>
              <button onClick={closeModal} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-5 space-y-4">

              {/* Logo upload */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-2"
                  style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                  Logo brand
                </label>
                <div className="flex items-center gap-4">
                  {/* Preview */}
                  <div className="w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden"
                    style={{ border: "1px solid #e5e7eb", background: "#f9fafb" }}>
                    {form.logoPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={form.logoPreview} alt="preview"
                        className="w-full h-full object-contain p-1" />
                    ) : (
                      <ImageIcon size={24} style={{ color: "#d1d5db" }} />
                    )}
                  </div>
                  {/* Upload button */}
                  <div className="flex-1 space-y-1.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold w-full justify-center hover:opacity-80 transition-opacity"
                      style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#374151" }}>
                      <Upload size={14} />
                      {form.logoFile ? form.logoFile.name : "Carica immagine"}
                    </button>
                    {form.logoPreview && (
                      <button type="button"
                        onClick={() => setForm((f) => ({ ...f, logoFile: null, logoPreview: null }))}
                        className="flex items-center gap-1 text-xs w-full justify-center"
                        style={{ color: "#EF4444", fontFamily: "var(--font-montserrat)" }}>
                        <X size={11} /> Rimuovi immagine
                      </button>
                    )}
                    <p className="text-[10px] text-center" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                      PNG, JPG, SVG — max 2 MB
                    </p>
                  </div>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={handleFileChange} />
              </div>

              {/* Nome */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                  style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                  Nome brand
                </label>
                <input
                  type="text"
                  value={form.nome}
                  onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                  placeholder="es. Michelin"
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)" }}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 flex items-center justify-between gap-2"
              style={{ borderTop: "1px solid #e5e7eb" }}>
              {editBrand ? (
                <button onClick={() => handleDelete(editBrand)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold hover:bg-red-50 transition-colors"
                  style={{ border: "1px solid #FCA5A5", color: "#DC2626", fontFamily: "var(--font-montserrat)" }}>
                  <Trash2 size={13} /> Elimina
                </button>
              ) : <span />}
              <div className="flex gap-2">
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
        </div>
      )}
    </div>
  );
}
