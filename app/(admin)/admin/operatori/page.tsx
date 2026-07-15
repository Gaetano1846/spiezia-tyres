"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Pencil, X, Check, Loader2, User, Mail } from "lucide-react";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";
import type { Ruolo } from "@/lib/types";
import type { OperatoreApi } from "@/lib/operatoriDb";
import type { SimpleEntity } from "@/lib/lookupDb";

const RUOLI_CRM: Ruolo[] = ["Admin", "Magazziniere", "Impiegato"];

type RefInfo = { id: string; nome: string };

type Operatore = {
  uid: string;
  email: string;
  displayName?: string;
  Ruolo: Ruolo;
  CRM: boolean;
  SedeId?: string | null;
  MansioneId?: string | null;
  RepartoId?: string | null;
  SedeNome?: string;
  MansioneNome?: string;
  RepartoNome?: string;
};

type FormState = {
  displayName: string;
  email: string;
  password: string;
  Ruolo: Ruolo;
  sedeId: string;
  mansioneId: string;
  repartoId: string;
};

const FORM_DEFAULT: FormState = {
  displayName: "", email: "", password: "",
  Ruolo: "Impiegato", sedeId: "", mansioneId: "", repartoId: "",
};

function toRefInfo(items: SimpleEntity[]): RefInfo[] {
  return items.map((i) => ({ id: i.id, nome: i.Nome }));
}

function toOperatore(o: OperatoreApi): Operatore {
  return {
    uid: o.id,
    email: o.email,
    displayName: o.displayName,
    Ruolo: (o.Ruolo ?? "Impiegato") as Ruolo,
    CRM: o.CRM,
    SedeId: o.SedeId,
    MansioneId: o.MansioneId,
    RepartoId: o.RepartoId,
    SedeNome: o.SedeNome,
    MansioneNome: o.MansioneNome,
    RepartoNome: o.RepartoNome,
  };
}

export default function OperatoriPage() {
  const [operatori, setOperatori] = useState<Operatore[]>([]);
  const [sedi,      setSedi]      = useState<RefInfo[]>([]);
  const [mansioni,  setMansioni]  = useState<RefInfo[]>([]);
  const [reparti,   setReparti]   = useState<RefInfo[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");

  const [showModal,   setShowModal]   = useState(false);
  const [editUid,     setEditUid]     = useState<string | null>(null);
  const [form,        setForm]        = useState<FormState>(FORM_DEFAULT);
  const [saving,      setSaving]      = useState(false);

  // Operatori: core.utenti (crm=true/Admin) via /api/operatori (Fase 7).
  // Sede/Mansione/Reparto: già su Postgres da fase precedente, via /api/lookup/:kind.
  async function loadAll() {
    setLoading(true);
    try {
      const [opRes, sedeRes, mansRes, repRes] = await Promise.all([
        fetch("/api/operatori"),
        fetch("/api/lookup/sede"),
        fetch("/api/lookup/mansione"),
        fetch("/api/lookup/reparto"),
      ]);
      if (!opRes.ok) throw new Error(String(opRes.status));

      const { operatori: opList } = (await opRes.json()) as { operatori: OperatoreApi[] };
      const { items: sedeItems } = (await sedeRes.json()) as { items: SimpleEntity[] };
      const { items: mansItems } = (await mansRes.json()) as { items: SimpleEntity[] };
      const { items: repItems } = (await repRes.json()) as { items: SimpleEntity[] };

      setSedi(toRefInfo(sedeItems ?? []));
      setMansioni(toRefInfo(mansItems ?? []));
      setReparti(toRefInfo(repItems ?? []));
      setOperatori((opList ?? []).map(toOperatore));
    } catch {
      toast.error("Errore nel caricamento operatori");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  function openEdit(op: Operatore) {
    setEditUid(op.uid);
    setForm({
      displayName: op.displayName ?? "",
      email:       op.email,
      password:    "",
      Ruolo:       op.Ruolo,
      sedeId:      op.SedeId ?? "",
      mansioneId:  op.MansioneId ?? "",
      repartoId:   op.RepartoId ?? "",
    });
    setShowModal(true);
  }

  function openNew() {
    setEditUid(null);
    setForm(FORM_DEFAULT);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditUid(null);
    setForm(FORM_DEFAULT);
  }

  async function handleSave() {
    if (!form.displayName.trim()) { toast.error("Inserisci il nome"); return; }
    if (!editUid && !form.email.trim()) { toast.error("Inserisci l'email"); return; }
    if (!editUid && form.password.length < 6) { toast.error("Password minimo 6 caratteri"); return; }
    setSaving(true);

    try {
      if (editUid) {
        const res = await fetch(`/api/operatori/${editUid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: form.displayName.trim(),
            ruolo: form.Ruolo,
            sedeId: form.sedeId,
            mansioneId: form.mansioneId,
            repartoId: form.repartoId,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        toast.success("Operatore aggiornato");
      } else {
        const res = await fetch("/api/operatori", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: form.displayName.trim(),
            email: form.email.trim(),
            password: form.password,
            ruolo: form.Ruolo,
            sedeId: form.sedeId,
            mansioneId: form.mansioneId,
            repartoId: form.repartoId,
          }),
        });
        if (res.status === 409) { toast.error("Email già in uso"); setSaving(false); return; }
        if (!res.ok) throw new Error(String(res.status));
        toast.success("Operatore creato");
      }

      closeModal();
      await loadAll();
    } catch {
      toast.error("Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  }

  const filtered = operatori.filter((o) => {
    const q = search.toLowerCase();
    return [o.displayName, o.email, o.Ruolo, o.SedeNome].join(" ").toLowerCase().includes(q);
  });

  const labelStyle = { color: "#9ca3af", fontFamily: "var(--font-montserrat)" };
  const inputStyle = {
    background: "#f9fafb", border: "1px solid #e5e7eb",
    fontFamily: "var(--font-montserrat)", color: "#111",
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Operatori CRM</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "Caricamento…" : `${operatori.length} operatori`}
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold hover:opacity-80 transition-all hover:brightness-[1.04] active:scale-[.98]"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}
        >
          <Plus size={15} /> Nuovo operatore
        </button>
      </div>

      <Card padding="sm">
        {/* Search */}
        <div className="relative mb-4 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
          <input
            placeholder="Cerca per nome, email, ruolo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl text-sm outline-none"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }}
          />
        </div>

        {/* Lista operatori */}
        {loading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "var(--bg-primary)" }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 gap-2">
            <User size={32} style={{ color: "#d1d5db" }} />
            <p className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              Nessun operatore trovato
            </p>
          </div>
        ) : (
          <>
            {/* Mobile: lista a card (la tabella su schermo stretto tagliava email/ruolo/sede) */}
            <div className="md:hidden space-y-2.5">
              {filtered.map((op) => {
                const meta = [op.SedeNome, op.MansioneNome, op.RepartoNome].filter(Boolean).join(" · ");
                return (
                  <div key={op.uid} className="rounded-xl p-3.5"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                        style={{ background: "#FFC803", color: "#111" }}>
                        {(op.displayName ?? op.email)[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate" style={{ color: "var(--text-primary)" }}>
                          {op.displayName ?? "—"}
                        </p>
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold mt-0.5"
                          style={{ background: op.Ruolo === "Admin" ? "#FEF3C7" : "#F3F4F6", color: op.Ruolo === "Admin" ? "#92400E" : "#374151" }}>
                          {op.Ruolo}
                        </span>
                      </div>
                      <button onClick={() => openEdit(op)}
                        className="flex items-center justify-center px-3 py-2 rounded-lg flex-shrink-0"
                        style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                        aria-label="Modifica">
                        <Pencil size={14} />
                      </button>
                    </div>
                    <div className="mt-2 space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                      <div className="flex items-center gap-2">
                        <Mail size={12} className="flex-shrink-0" style={{ color: "var(--text-muted)" }} />
                        <span className="truncate">{op.email}</span>
                      </div>
                      {meta && <div className="truncate">{meta}</div>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop: tabella */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", background: "#111" }}>
                    {["Nome", "Email", "Ruolo", "Sede", "Mansione", "Reparto", ""].map((h) => (
                      <th key={h} className="text-left px-4 py-2.5 text-[9px] font-bold uppercase tracking-wider"
                        style={{ color: "#fff", fontFamily: "var(--font-montserrat)", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((op) => (
                    <tr key={op.uid} className="border-b hover:bg-[#FFFDF0] transition-colors"
                      style={{ borderColor: "var(--border)" }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                            style={{ background: "#FFC803", color: "#111" }}>
                            {(op.displayName ?? op.email)[0]?.toUpperCase()}
                          </div>
                          <span className="font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                            {op.displayName ?? "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {op.email}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ background: op.Ruolo === "Admin" ? "#FEF3C7" : "#F3F4F6", color: op.Ruolo === "Admin" ? "#92400E" : "#374151", fontFamily: "var(--font-montserrat)" }}>
                          {op.Ruolo}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {op.SedeNome ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {op.MansioneNome ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {op.RepartoNome ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => openEdit(op)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold hover:bg-gray-100 transition-colors"
                          style={{ border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }}>
                          <Pencil size={10} /> Modifica
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* ── Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden"
            style={{ background: "#fff", boxShadow: "var(--shadow-xl)" }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #e5e7eb" }}>
              <h2 className="text-base font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
                {editUid ? "Modifica operatore" : "Nuovo operatore"}
              </h2>
              <button onClick={closeModal} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-5 space-y-3">

              {/* Nome */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={labelStyle}>Nome</label>
                <input type="text" value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                  placeholder="Mario Rossi" className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} />
              </div>

              {/* Email + Password (solo nuovo) */}
              {!editUid && (
                <>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={labelStyle}>Email</label>
                    <input type="email" value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="mario@spiezia.it" className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={labelStyle}>Password provvisoria</label>
                    <input type="password" value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      placeholder="min. 6 caratteri" className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} />
                  </div>
                </>
              )}

              {/* Ruolo */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={labelStyle}>Ruolo</label>
                <select value={form.Ruolo} onChange={(e) => setForm((f) => ({ ...f, Ruolo: e.target.value as Ruolo }))}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle}>
                  {RUOLI_CRM.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* Sede */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={labelStyle}>Sede</label>
                <select value={form.sedeId} onChange={(e) => setForm((f) => ({ ...f, sedeId: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle}>
                  <option value="">— Nessuna —</option>
                  {sedi.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </div>

              {/* Mansione */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={labelStyle}>Mansione</label>
                <select value={form.mansioneId} onChange={(e) => setForm((f) => ({ ...f, mansioneId: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle}>
                  <option value="">— Nessuna —</option>
                  {mansioni.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
              </div>

              {/* Reparto */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={labelStyle}>Reparto</label>
                <select value={form.repartoId} onChange={(e) => setForm((f) => ({ ...f, repartoId: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle}>
                  <option value="">— Nessuno —</option>
                  {reparti.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
                </select>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 flex justify-end gap-2" style={{ borderTop: "1px solid #e5e7eb" }}>
              <button onClick={closeModal} className="px-4 py-2 rounded-xl text-sm font-semibold"
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
