"use client";

import { useState, useEffect } from "react";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Plus, Pencil, Trash2, X, Check, Loader2, Eye, EyeOff, MessageSquare } from "lucide-react";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";

type PopUpDoc = {
  id: string;
  Titolo: string;
  Descrizione?: string;
  Immagine?: string;
  Link?: string;
  ButtonText?: string;
  Attivo: boolean;
};

type PopUpForm = {
  titolo:      string;
  descrizione: string;
  immagine:    string;
  link:        string;
  buttonText:  string;
  attivo:      boolean;
};

const emptyForm = (): PopUpForm => ({
  titolo: "", descrizione: "", immagine: "", link: "", buttonText: "Scopri di più", attivo: true,
});

export default function PopUpPage() {
  const [popups,  setPopups]  = useState<PopUpDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId,    setEditId]    = useState<string | null>(null);
  const [form,      setForm]      = useState<PopUpForm>(emptyForm());
  const [saving,    setSaving]    = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "Pop-Up"));
      setPopups(snap.docs.map((d) => ({
        id:          d.id,
        Titolo:      d.data().Titolo      ?? "",
        Descrizione: d.data().Descrizione,
        Immagine:    d.data().Immagine,
        Link:        d.data().Link,
        ButtonText:  d.data().ButtonText,
        Attivo:      d.data().Attivo      ?? true,
      })));
    } catch {
      toast.error("Errore nel caricamento");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  function openNew() {
    setEditId(null);
    setForm(emptyForm());
    setShowModal(true);
  }

  function openEdit(p: PopUpDoc) {
    setEditId(p.id);
    setForm({
      titolo:      p.Titolo,
      descrizione: p.Descrizione ?? "",
      immagine:    p.Immagine    ?? "",
      link:        p.Link        ?? "",
      buttonText:  p.ButtonText  ?? "Scopri di più",
      attivo:      p.Attivo,
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.titolo.trim()) { toast.error("Inserisci il titolo"); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        Titolo:      form.titolo.trim(),
        Descrizione: form.descrizione.trim() || null,
        Immagine:    form.immagine.trim()    || null,
        Link:        form.link.trim()        || null,
        ButtonText:  form.buttonText.trim()  || "Scopri di più",
        Attivo:      form.attivo,
      };
      if (editId) {
        payload.DataAggiornamento = serverTimestamp();
        await updateDoc(doc(db, "Pop-Up", editId), payload);
        toast.success("Pop-Up aggiornato");
      } else {
        payload.DataCreazione = serverTimestamp();
        await addDoc(collection(db, "Pop-Up"), payload);
        toast.success("Pop-Up aggiunto");
      }
      setShowModal(false);
      await loadAll();
    } catch {
      toast.error("Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleAttivo(p: PopUpDoc) {
    await updateDoc(doc(db, "Pop-Up", p.id), { Attivo: !p.Attivo });
    setPopups((prev) => prev.map((x) => x.id === p.id ? { ...x, Attivo: !p.Attivo } : x));
    toast.success(p.Attivo ? "Pop-Up disattivato" : "Pop-Up attivato");
  }

  async function handleDelete(p: PopUpDoc) {
    if (!confirm(`Eliminare il pop-up "${p.Titolo}"?`)) return;
    await deleteDoc(doc(db, "Pop-Up", p.id));
    setPopups((prev) => prev.filter((x) => x.id !== p.id));
    toast.success("Pop-Up eliminato");
  }

  const inputCls = "w-full px-3 py-2.5 rounded-xl text-sm outline-none";
  const inputSty = { background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" };
  const labelSty = { color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Pop-Up</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            Messaggi in evidenza mostrati agli utenti B2B al primo accesso
          </p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold hover:opacity-80 transition-opacity"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}>
          <Plus size={13} /> Nuovo pop-up
        </button>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="w-full max-w-lg rounded-2xl p-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                {editId ? "Modifica pop-up" : "Nuovo pop-up"}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-[#F1F4F8]">
                <X size={16} style={{ color: "var(--text-muted)" }} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={labelSty}>Titolo *</label>
                <input value={form.titolo} onChange={(e) => setForm((f) => ({ ...f, titolo: e.target.value }))}
                  placeholder="es. Nuove tariffe estive disponibili"
                  className={inputCls} style={inputSty} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={labelSty}>Descrizione</label>
                <textarea value={form.descrizione} onChange={(e) => setForm((f) => ({ ...f, descrizione: e.target.value }))}
                  rows={3} placeholder="Testo del messaggio…"
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
                  style={inputSty} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={labelSty}>URL immagine</label>
                <input value={form.immagine} onChange={(e) => setForm((f) => ({ ...f, immagine: e.target.value }))}
                  placeholder="https://…"
                  className={inputCls} style={inputSty} />
              </div>
              {form.immagine && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.immagine} alt="anteprima" className="w-full max-h-40 object-cover rounded-xl" />
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={labelSty}>Link azione</label>
                  <input value={form.link} onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))}
                    placeholder="https://… o /prodotti"
                    className={inputCls} style={inputSty} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={labelSty}>Testo pulsante</label>
                  <input value={form.buttonText} onChange={(e) => setForm((f) => ({ ...f, buttonText: e.target.value }))}
                    placeholder="Scopri di più"
                    className={inputCls} style={inputSty} />
                </div>
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer pt-1">
                <div className="relative">
                  <input type="checkbox" checked={form.attivo} onChange={(e) => setForm((f) => ({ ...f, attivo: e.target.checked }))}
                    className="sr-only" />
                  <div className="w-9 h-5 rounded-full transition-colors" style={{ background: form.attivo ? "var(--brand)" : "#d1d5db" }}>
                    <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                      style={{ transform: form.attivo ? "translateX(18px)" : "translateX(2px)" }} />
                  </div>
                </div>
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                  {form.attivo ? "Attivo" : "Disattivato"}
                </span>
              </label>
            </div>

            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
                Annulla
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {editId ? "Salva modifiche" : "Crea pop-up"}
              </button>
            </div>
          </div>
        </div>
      )}

      <Card>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "var(--border)" }} />
            ))}
          </div>
        ) : popups.length === 0 ? (
          <div className="text-center py-16" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
            <MessageSquare size={36} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nessun pop-up. Crea il primo messaggio.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {popups.map((p) => (
              <div key={p.id} className="flex items-start gap-4 p-4 rounded-xl"
                style={{ background: "var(--bg-primary)", border: `1px solid ${p.Attivo ? "var(--border)" : "#e5e7eb"}`, opacity: p.Attivo ? 1 : 0.6 }}>

                {p.Immagine && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.Immagine} alt={p.Titolo} className="w-16 h-16 object-cover rounded-xl flex-shrink-0" />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                      {p.Titolo}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: p.Attivo ? "#D1FAE5" : "#e5e7eb", color: p.Attivo ? "#065F46" : "#6b7280", fontFamily: "var(--font-montserrat)" }}>
                      {p.Attivo ? "Attivo" : "Disattivato"}
                    </span>
                  </div>
                  {p.Descrizione && (
                    <p className="text-xs mb-1 line-clamp-2" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                      {p.Descrizione}
                    </p>
                  )}
                  {p.Link && (
                    <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                      → {p.Link} {p.ButtonText && `· "${p.ButtonText}"`}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => handleToggleAttivo(p)} title={p.Attivo ? "Disattiva" : "Attiva"}
                    className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                    {p.Attivo ? <EyeOff size={13} style={{ color: "var(--text-muted)" }} /> : <Eye size={13} style={{ color: "#249689" }} />}
                  </button>
                  <button onClick={() => openEdit(p)} title="Modifica"
                    className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                    <Pencil size={13} style={{ color: "var(--text-muted)" }} />
                  </button>
                  <button onClick={() => handleDelete(p)} title="Elimina"
                    className="p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                    <Trash2 size={13} style={{ color: "#EF4444" }} />
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
