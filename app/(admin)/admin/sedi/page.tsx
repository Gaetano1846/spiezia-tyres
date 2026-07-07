"use client";

import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, X, Check, Loader2, MapPin, Briefcase, Users } from "lucide-react";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";

type SimpleDoc = { id: string; Nome: string; Indirizzo?: string; Citta?: string };
type SimpleForm = { nome: string; indirizzo: string; citta: string };
const FORM_DEFAULT: SimpleForm = { nome: "", indirizzo: "", citta: "" };

// ── Generic CRUD section ─────────────────────────────────────────────────────

function CrudSection({
  title,
  icon: Icon,
  items,
  loading,
  onAdd,
  onEdit,
  onDelete,
  withAddress,
}: {
  title: string;
  icon: React.ElementType;
  items: SimpleDoc[];
  loading: boolean;
  onAdd: (f: SimpleForm) => Promise<void>;
  onEdit: (id: string, f: SimpleForm) => Promise<void>;
  onDelete: (id: string, nome: string) => Promise<void>;
  withAddress?: boolean;
}) {
  const [showForm,  setShowForm]  = useState(false);
  const [editId,    setEditId]    = useState<string | null>(null);
  const [form,      setForm]      = useState<SimpleForm>(FORM_DEFAULT);
  const [saving,    setSaving]    = useState(false);

  function openNew()             { setEditId(null); setForm(FORM_DEFAULT); setShowForm(true); }
  function openEdit(d: SimpleDoc){ setEditId(d.id); setForm({ nome: d.Nome, indirizzo: d.Indirizzo ?? "", citta: d.Citta ?? "" }); setShowForm(true); }
  function closeForm()           { setShowForm(false); setEditId(null); setForm(FORM_DEFAULT); }

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

      {/* Inline add/edit form */}
      {showForm && (
        <div className="mb-4 p-4 rounded-xl space-y-3" style={{ background: "#f9fafb", border: "1px solid #e5e7eb" }}>
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-1" style={labelSty}>Nome *</label>
            <input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
              placeholder="es. Nola, Impiegato, Officina" className={inputCls} style={inputSty}
              onKeyDown={(e) => e.key === "Enter" && submit()} />
          </div>
          {withAddress && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-1" style={labelSty}>Indirizzo</label>
                <input value={form.indirizzo} onChange={(e) => setForm((f) => ({ ...f, indirizzo: e.target.value }))}
                  placeholder="Via e numero" className={inputCls} style={inputSty} />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-1" style={labelSty}>Città</label>
                <input value={form.citta} onChange={(e) => setForm((f) => ({ ...f, citta: e.target.value }))}
                  placeholder="es. Nola" className={inputCls} style={inputSty} />
              </div>
            </div>
          )}
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

      {/* List */}
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
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                  {d.Nome}
                </p>
                {withAddress && (d.Indirizzo || d.Citta) && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                    {[d.Indirizzo, d.Citta].filter(Boolean).join(" — ")}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => openEdit(d)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                  title="Modifica">
                  <Pencil size={13} style={{ color: "var(--text-muted)" }} />
                </button>
                <button onClick={() => onDelete(d.id, d.Nome)}
                  className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                  title="Elimina">
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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SediPage() {
  const [sedi,     setSedi]     = useState<SimpleDoc[]>([]);
  const [mansioni, setMansioni] = useState<SimpleDoc[]>([]);
  const [reparti,  setReparti]  = useState<SimpleDoc[]>([]);
  const [loading,  setLoading]  = useState(true);

  async function loadAll() {
    setLoading(true);
    try {
      const [sedeRes, mansRes, repRes] = await Promise.all([
        fetch("/api/lookup/sede"),
        fetch("/api/lookup/mansione"),
        fetch("/api/lookup/reparto"),
      ]);
      const [sedeJson, mansJson, repJson] = await Promise.all([sedeRes.json(), mansRes.json(), repRes.json()]);
      if (!sedeRes.ok || !mansRes.ok || !repRes.ok) throw new Error("Errore nel caricamento");
      setSedi(sedeJson.items);
      setMansioni(mansJson.items);
      setReparti(repJson.items);
    } catch {
      toast.error("Errore nel caricamento");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function createOrUpdate(kind: "sede" | "mansione" | "reparto", id: string | null, f: SimpleForm) {
    const body = { nome: f.nome.trim(), indirizzo: f.indirizzo.trim(), citta: f.citta.trim() };
    const res = await fetch(id ? `/api/lookup/${kind}/${encodeURIComponent(id)}` : `/api/lookup/${kind}`, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Errore nel salvataggio");
  }

  async function removeItem(kind: "sede" | "mansione" | "reparto", id: string) {
    const res = await fetch(`/api/lookup/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Errore nell'eliminazione");
  }

  // ── SEDE ──────────────────────────────────────────────────────────────────

  async function addSede(f: SimpleForm) {
    await createOrUpdate("sede", null, f);
    toast.success("Sede aggiunta");
    await loadAll();
  }
  async function editSede(id: string, f: SimpleForm) {
    await createOrUpdate("sede", id, f);
    toast.success("Sede aggiornata");
    await loadAll();
  }
  async function deleteSede(id: string, nome: string) {
    if (!confirm(`Eliminare la sede "${nome}"? Gli operatori assegnati perderanno il riferimento.`)) return;
    await removeItem("sede", id);
    toast.success("Sede eliminata");
    setSedi((p) => p.filter((s) => s.id !== id));
  }

  // ── MANSIONE ─────────────────────────────────────────────────────────────

  async function addMansione(f: SimpleForm) {
    await createOrUpdate("mansione", null, f);
    toast.success("Mansione aggiunta");
    await loadAll();
  }
  async function editMansione(id: string, f: SimpleForm) {
    await createOrUpdate("mansione", id, f);
    toast.success("Mansione aggiornata");
    await loadAll();
  }
  async function deleteMansione(id: string, nome: string) {
    if (!confirm(`Eliminare la mansione "${nome}"?`)) return;
    await removeItem("mansione", id);
    toast.success("Mansione eliminata");
    setMansioni((p) => p.filter((m) => m.id !== id));
  }

  // ── REPARTO ──────────────────────────────────────────────────────────────

  async function addReparto(f: SimpleForm) {
    await createOrUpdate("reparto", null, f);
    toast.success("Reparto aggiunto");
    await loadAll();
  }
  async function editReparto(id: string, f: SimpleForm) {
    await createOrUpdate("reparto", id, f);
    toast.success("Reparto aggiornato");
    await loadAll();
  }
  async function deleteReparto(id: string, nome: string) {
    if (!confirm(`Eliminare il reparto "${nome}"?`)) return;
    await removeItem("reparto", id);
    toast.success("Reparto eliminato");
    setReparti((p) => p.filter((r) => r.id !== id));
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Configurazione</h1>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
          Sedi operative, mansioni e reparti
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CrudSection
          title="Sedi"
          icon={MapPin}
          items={sedi}
          loading={loading}
          onAdd={addSede}
          onEdit={editSede}
          onDelete={deleteSede}
          withAddress
        />
        <CrudSection
          title="Mansioni"
          icon={Briefcase}
          items={mansioni}
          loading={loading}
          onAdd={addMansione}
          onEdit={editMansione}
          onDelete={deleteMansione}
        />
        <CrudSection
          title="Reparti"
          icon={Users}
          items={reparti}
          loading={loading}
          onAdd={addReparto}
          onEdit={editReparto}
          onDelete={deleteReparto}
        />
      </div>
    </div>
  );
}
