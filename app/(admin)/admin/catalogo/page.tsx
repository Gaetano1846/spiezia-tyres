"use client";

import { useState, useEffect } from "react";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Plus, Pencil, Trash2, Check, Loader2, Tag, Settings, Layers } from "lucide-react";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";

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
  const [modelli,    setModelli]    = useState<SimpleDoc[]>([]);
  const [categorie,  setCategorie]  = useState<SimpleDoc[]>([]);
  const [loading,    setLoading]    = useState(true);

  async function loadAll() {
    setLoading(true);
    try {
      const [servSnap, modSnap, catSnap] = await Promise.all([
        getDocs(collection(db, "Servizi")),
        getDocs(collection(db, "Modello")),
        getDocs(collection(db, "Categoria_Prodotti")),
      ]);
      setServizi(servSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SimpleDoc, "id">) })));
      setModelli(modSnap.docs.map((d)  => ({ id: d.id, ...(d.data() as Omit<SimpleDoc, "id">) })));
      setCategorie(catSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SimpleDoc, "id">) })));
    } catch {
      toast.error("Errore nel caricamento");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  // ── SERVIZI ──────────────────────────────────────────────────────────────────

  async function addServizio(f: SimpleForm) {
    await addDoc(collection(db, "Servizi"), { Nome: f.nome.trim() });
    toast.success("Servizio aggiunto"); await loadAll();
  }
  async function editServizio(id: string, f: SimpleForm) {
    await updateDoc(doc(db, "Servizi", id), { Nome: f.nome.trim() });
    toast.success("Servizio aggiornato"); await loadAll();
  }
  async function deleteServizio(id: string, nome: string) {
    if (!confirm(`Eliminare il servizio "${nome}"?`)) return;
    await deleteDoc(doc(db, "Servizi", id));
    toast.success("Servizio eliminato");
    setServizi((p) => p.filter((s) => s.id !== id));
  }

  // ── MODELLI ──────────────────────────────────────────────────────────────────

  async function addModello(f: SimpleForm) {
    await addDoc(collection(db, "Modello"), { Nome: f.nome.trim() });
    toast.success("Modello aggiunto"); await loadAll();
  }
  async function editModello(id: string, f: SimpleForm) {
    await updateDoc(doc(db, "Modello", id), { Nome: f.nome.trim() });
    toast.success("Modello aggiornato"); await loadAll();
  }
  async function deleteModello(id: string, nome: string) {
    if (!confirm(`Eliminare il modello "${nome}"?`)) return;
    await deleteDoc(doc(db, "Modello", id));
    toast.success("Modello eliminato");
    setModelli((p) => p.filter((m) => m.id !== id));
  }

  // ── CATEGORIE ────────────────────────────────────────────────────────────────

  async function addCategoria(f: SimpleForm) {
    await addDoc(collection(db, "Categoria_Prodotti"), { Nome: f.nome.trim() });
    toast.success("Categoria aggiunta"); await loadAll();
  }
  async function editCategoria(id: string, f: SimpleForm) {
    await updateDoc(doc(db, "Categoria_Prodotti", id), { Nome: f.nome.trim() });
    toast.success("Categoria aggiornata"); await loadAll();
  }
  async function deleteCategoria(id: string, nome: string) {
    if (!confirm(`Eliminare la categoria "${nome}"?`)) return;
    await deleteDoc(doc(db, "Categoria_Prodotti", id));
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
          loading={loading}
          onAdd={addModello}
          onEdit={editModello}
          onDelete={deleteModello}
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
