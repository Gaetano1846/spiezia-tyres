"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, Check, Loader2, Tag, Settings, Layers } from "lucide-react";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";
import { useModelliInfiniteList } from "@/hooks/useModelliInfiniteList";
import type { ModelloApi } from "@/lib/modelliDb";

type SimpleDoc = { id: string; Nome: string };
type SimpleForm = { nome: string };
const FORM_DEFAULT: SimpleForm = { nome: "" };

function CrudSection({
  title,
  icon: Icon,
  items,
  loading,
  onAdd,
  onEdit,
  onDelete,
}: {
  title: string;
  icon: React.ElementType;
  items: SimpleDoc[];
  loading: boolean;
  onAdd: (f: SimpleForm) => Promise<void>;
  onEdit: (id: string, f: SimpleForm) => Promise<void>;
  onDelete: (id: string, nome: string) => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editId,   setEditId]   = useState<string | null>(null);
  const [form,     setForm]     = useState<SimpleForm>(FORM_DEFAULT);
  const [saving,   setSaving]   = useState(false);

  function openNew()              { setEditId(null); setForm(FORM_DEFAULT); setShowForm(true); }
  function openEdit(d: SimpleDoc) { setEditId(d.id); setForm({ nome: d.Nome }); setShowForm(true); }
  function closeForm()            { setShowForm(false); setEditId(null); setForm(FORM_DEFAULT); }

  async function submit() {
    if (!form.nome.trim()) { toast.error("Inserisci il nome"); return; }
    setSaving(true);
    try {
      if (editId) await onEdit(editId, form);
      else        await onAdd(form);
      closeForm();
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full px-3 py-2 rounded-xl text-sm outline-none";
  const inputSty = { background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#111" };
  const labelSty = { color: "#9ca3af", fontFamily: "var(--font-montserrat)" };

  return (
    <Card padding="sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon size={16} style={{ color: "var(--text-muted)" }} />
          <h2 className="text-base font-bold" style={{ fontFamily: "var(--font-poppins)" }}>{title}</h2>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#f3f4f6", color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
            {items.length}
          </span>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold hover:opacity-80 transition-all hover:brightness-[1.04] active:scale-[.98]"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}>
          <Plus size={12} /> Aggiungi
        </button>
      </div>

      {showForm && (
        <div className="mb-4 p-4 rounded-xl space-y-3" style={{ background: "#f9fafb", border: "1px solid #e5e7eb" }}>
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-1" style={labelSty}>Nome *</label>
            <input value={form.nome} onChange={(e) => setForm({ nome: e.target.value })}
              placeholder="es. Cambio gomme, Auto, Stagione estiva"
              className={inputCls} style={inputSty}
              onKeyDown={(e) => e.key === "Enter" && submit()} />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={closeForm} className="px-3 py-1.5 rounded-xl text-xs font-semibold"
              style={{ background: "#fff", border: "1px solid #e5e7eb", color: "#374151", fontFamily: "var(--font-montserrat)" }}>
              Annulla
            </button>
            <button onClick={submit} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold disabled:opacity-60 transition-all hover:brightness-[1.04] active:scale-[.98] disabled:active:scale-100"
              style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}>
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              {editId ? "Salva" : "Aggiungi"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 rounded-xl animate-pulse" style={{ background: "var(--border)" }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-center py-6" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
          Nessun elemento
        </p>
      ) : (
        <div className="space-y-1.5">
          {items.map((d) => (
            <div key={d.id} className="flex items-center justify-between px-4 py-2.5 rounded-xl"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                {d.Nome}
              </p>
              <div className="flex items-center gap-1.5">
                <button onClick={() => openEdit(d)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors" title="Modifica">
                  <Pencil size={13} style={{ color: "var(--text-muted)" }} />
                </button>
                <button onClick={() => onDelete(d.id, d.Nome)}
                  className="p-1.5 rounded-lg hover:bg-red-50 transition-colors" title="Elimina">
                  <Trash2 size={13} style={{ color: "#EF4444" }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function CatalogoPage() {
  const [servizi,    setServizi]    = useState<SimpleDoc[]>([]);
  const [categorie,  setCategorie]  = useState<SimpleDoc[]>([]);
  const [loading,    setLoading]    = useState(true);

  // Modelli: stesso dominio Postgres (b2b.modelli) usato da /admin/disegni —
  // CRUD leggero qui (solo Nome, nessuna gestione immagine/sinonimi).
  // Drain automatico in background, stesso pattern usato altrove per evitare
  // di bloccare il render su migliaia di righe caricate in un colpo solo.
  const {
    items: modelli,
    loading: modelliLoading,
    hasMore: modelliHasMore,
    loadAll: drainModelli,
    reload: reloadModelli,
    mutate: mutateModelli,
  } = useModelliInfiniteList<SimpleDoc>({
    pageSize: 100,
    mapItem: useCallback((m: ModelloApi) => ({ id: m.id, Nome: m.Nome }), []),
  });
  useEffect(() => {
    if (!modelliLoading && modelliHasMore) drainModelli();
  }, [modelliLoading, modelliHasMore, drainModelli]);

  async function loadLookups() {
    setLoading(true);
    try {
      const [servRes, catRes] = await Promise.all([
        fetch("/api/lookup/servizio"),
        fetch("/api/lookup/categoria"),
      ]);
      const [servJson, catJson] = await Promise.all([servRes.json(), catRes.json()]);
      if (!servRes.ok || !catRes.ok) throw new Error("Errore nel caricamento");
      setServizi(servJson.items);
      setCategorie(catJson.items);
    } catch {
      toast.error("Errore nel caricamento");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadLookups(); }, []);

  async function createOrUpdate(kind: "servizio" | "categoria", id: string | null, f: SimpleForm) {
    const res = await fetch(id ? `/api/lookup/${kind}/${encodeURIComponent(id)}` : `/api/lookup/${kind}`, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: f.nome.trim() }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Errore nel salvataggio");
  }

  async function removeItem(kind: "servizio" | "categoria", id: string) {
    const res = await fetch(`/api/lookup/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Errore nell'eliminazione");
  }

  // ── SERVIZI ──────────────────────────────────────────────────────────────────

  async function addServizio(f: SimpleForm) {
    await createOrUpdate("servizio", null, f);
    toast.success("Servizio aggiunto"); await loadLookups();
  }
  async function editServizio(id: string, f: SimpleForm) {
    await createOrUpdate("servizio", id, f);
    toast.success("Servizio aggiornato"); await loadLookups();
  }
  async function deleteServizio(id: string, nome: string) {
    if (!confirm(`Eliminare il servizio "${nome}"?`)) return;
    await removeItem("servizio", id);
    toast.success("Servizio eliminato");
    setServizi((p) => p.filter((s) => s.id !== id));
  }

  // ── MODELLI ──────────────────────────────────────────────────────────────────

  async function addModello(f: SimpleForm) {
    const body = new FormData();
    body.set("nome", f.nome.trim());
    const res = await fetch("/api/modelli", { method: "POST", body });
    if (!res.ok) throw new Error("Errore nel salvataggio");
    toast.success("Modello aggiunto"); reloadModelli();
  }
  async function editModello(id: string, f: SimpleForm) {
    const body = new FormData();
    body.set("nome", f.nome.trim());
    const res = await fetch(`/api/modelli/${id}`, { method: "PATCH", body });
    if (!res.ok) throw new Error("Errore nel salvataggio");
    toast.success("Modello aggiornato");
    mutateModelli((prev) => prev.map((m) => (m.id === id ? { ...m, Nome: f.nome.trim() } : m)));
  }
  async function deleteModelloItem(id: string, nome: string) {
    if (!confirm(`Eliminare il modello "${nome}"?`)) return;
    const res = await fetch(`/api/modelli/${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Errore nell'eliminazione"); return; }
    toast.success("Modello eliminato");
    mutateModelli((p) => p.filter((m) => m.id !== id));
  }

  // ── CATEGORIE ────────────────────────────────────────────────────────────────

  async function addCategoria(f: SimpleForm) {
    await createOrUpdate("categoria", null, f);
    toast.success("Categoria aggiunta"); await loadLookups();
  }
  async function editCategoria(id: string, f: SimpleForm) {
    await createOrUpdate("categoria", id, f);
    toast.success("Categoria aggiornata"); await loadLookups();
  }
  async function deleteCategoria(id: string, nome: string) {
    if (!confirm(`Eliminare la categoria "${nome}"?`)) return;
    await removeItem("categoria", id);
    toast.success("Categoria eliminata");
    setCategorie((p) => p.filter((c) => c.id !== id));
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Catalogo</h1>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
          Servizi officina, modelli veicolo e categorie prodotto
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CrudSection
          title="Servizi"
          icon={Settings}
          items={servizi}
          loading={loading}
          onAdd={addServizio}
          onEdit={editServizio}
          onDelete={deleteServizio}
        />
        <CrudSection
          title="Modelli"
          icon={Tag}
          items={modelli}
          loading={modelliLoading}
          onAdd={addModello}
          onEdit={editModello}
          onDelete={deleteModelloItem}
        />
        <CrudSection
          title="Categorie"
          icon={Layers}
          items={categorie}
          loading={loading}
          onAdd={addCategoria}
          onEdit={editCategoria}
          onDelete={deleteCategoria}
        />
      </div>
    </div>
  );
}
