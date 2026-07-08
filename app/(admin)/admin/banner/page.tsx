"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Upload, Eye, EyeOff, ImageIcon, Loader2, Star, StarOff } from "lucide-react";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";
import type { BannerApi } from "@/lib/bannerDb";

export default function BannerPage() {
  const [banners, setBanners]   = useState<BannerApi[]>([]);
  const [loading, setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const res = await fetch("/api/banner");
      if (!res.ok) throw new Error(String(res.status));
      const { banners } = await res.json();
      setBanners(banners);
    } catch {
      toast.error("Errore nel caricamento");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Seleziona un'immagine"); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/banner", { method: "POST", body: form });
      if (!res.ok) throw new Error(String(res.status));
      toast.success("Banner aggiunto");
      await loadAll();
    } catch {
      toast.error("Errore nel caricamento immagine");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function toggleAttivo(b: BannerApi) {
    const res = await fetch(`/api/banner/${b.id}`, { method: "PATCH" });
    if (!res.ok) { toast.error("Errore nell'aggiornamento"); return; }
    setBanners((prev) => prev.map((x) => x.id === b.id ? { ...x, Attivo: !b.Attivo } : x));
  }

  async function toggleCopertina(b: BannerApi) {
    const newVal = !b.Copertina;
    const res = await fetch(`/api/banner/${b.id}/copertina`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: newVal }),
    });
    if (!res.ok) { toast.error("Errore nell'aggiornamento"); return; }
    setBanners((prev) => prev.map((x) => ({
      ...x,
      Copertina: newVal ? x.id === b.id : (x.id === b.id ? false : x.Copertina),
    })));
  }

  async function handleDelete(b: BannerApi) {
    if (!confirm("Eliminare questo banner?")) return;
    const res = await fetch(`/api/banner/${b.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Errore nell'eliminazione"); return; }
    setBanners((prev) => prev.filter((x) => x.id !== b.id));
    toast.success("Banner eliminato");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Banner</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            Immagini promozionali mostrate nella homepage B2B
          </p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-60 hover:opacity-80 transition-all hover:brightness-[1.04] active:scale-[.98] disabled:active:scale-100"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}
        >
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {uploading ? "Caricamento…" : "Carica immagine"}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
      </div>

      <Card>
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="aspect-video rounded-xl animate-pulse" style={{ background: "var(--border)" }} />
            ))}
          </div>
        ) : banners.length === 0 ? (
          <div className="text-center py-16" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
            <ImageIcon size={36} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nessun banner. Carica la prima immagine.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {banners.map((b) => (
              <div key={b.id} className="relative group rounded-xl overflow-hidden border"
                style={{ borderColor: b.Copertina ? "#FFC803" : "var(--border)", borderWidth: b.Copertina ? 2 : 1 }}>

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={b.Url}
                  alt="Banner"
                  className="w-full aspect-video object-cover"
                />

                {/* Badges */}
                <div className="absolute top-2 left-2 flex gap-1.5 flex-wrap">
                  {b.Copertina && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}>
                      Copertina
                    </span>
                  )}
                  {!b.Attivo && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: "#e5e7eb", color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
                      Nascosto
                    </span>
                  )}
                </div>

                {/* Actions overlay */}
                <div className="absolute inset-0 flex items-end justify-end p-2 gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 60%)" }}>
                  <button onClick={() => toggleCopertina(b)} title={b.Copertina ? "Rimuovi copertina" : "Imposta come copertina"}
                    className="p-1.5 rounded-lg transition-colors"
                    style={{ background: b.Copertina ? "#FFC803" : "rgba(255,255,255,0.9)" }}>
                    {b.Copertina ? <Star size={13} style={{ color: "#111" }} /> : <StarOff size={13} style={{ color: "#374151" }} />}
                  </button>
                  <button onClick={() => toggleAttivo(b)} title={b.Attivo ? "Nascondi" : "Mostra"}
                    className="p-1.5 rounded-lg transition-colors"
                    style={{ background: "rgba(255,255,255,0.9)" }}>
                    {b.Attivo ? <Eye size={13} style={{ color: "#374151" }} /> : <EyeOff size={13} style={{ color: "#374151" }} />}
                  </button>
                  <button onClick={() => handleDelete(b)} title="Elimina"
                    className="p-1.5 rounded-lg transition-colors"
                    style={{ background: "rgba(255,255,255,0.9)" }}>
                    <Trash2 size={13} style={{ color: "#DC2626" }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
