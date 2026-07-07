"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Eye, X, Check, Phone, Mail } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";
import type { Cliente } from "@/lib/types";

type NuovoClienteForm = {
  Nome: string;
  Email: string;
  Telefono: string;
  Via: string;
  Citta: string;
  CAP: string;
  Codice_Fiscale: string;
  Partita_Iva: string;
  PEC: string;
  Azienda: boolean;
  Ragione_Sociale: string;
};

const emptyForm = (): NuovoClienteForm => ({
  Nome: "", Email: "", Telefono: "", Via: "", Citta: "", CAP: "",
  Codice_Fiscale: "", Partita_Iva: "", PEC: "",
  Azienda: false, Ragione_Sociale: "",
});

export default function ClientiPage() {
  const [clienti, setClienti] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<NuovoClienteForm>(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchClienti = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/clienti?limit=200");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { clienti } = (await res.json()) as { clienti: Cliente[] };
        setClienti(clienti);
      } catch (e) {
        toast.error("Errore nel caricamento clienti");
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchClienti();
  }, []);

  function nomeDisplay(c: Cliente): string {
    if (c.Azienda && c.Ragione_Sociale) return c.Ragione_Sociale;
    return c.Nome?.trim() || c.Ragione_Sociale || "—";
  }

  const filtered = clienti.filter((c) => {
    const nome = nomeDisplay(c);
    return !search || [nome, c.Email ?? "", c.Telefono ?? ""].join(" ").toLowerCase().includes(search.toLowerCase());
  });

  async function handleSave() {
    if (!form.Nome && !form.Ragione_Sociale) {
      toast.error("Inserisci il nome o la ragione sociale");
      return;
    }
    if (!form.Email || !form.Telefono || !form.CAP) {
      toast.error("Compila i campi obbligatori: Email, Telefono, CAP");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/clienti", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Errore nella creazione del cliente");

      const newC: Cliente = { id: data.id!, ...form, Locale: true, B2B: false };
      setClienti((prev) => [...prev, newC]);
      toast.success("Cliente creato");
      setShowModal(false);
      setForm(emptyForm());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore nella creazione del cliente");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Modal nuovo cliente */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div
            className="w-full max-w-lg rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                Nuovo cliente
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-[#F1F4F8]">
                <X size={16} style={{ color: "var(--text-muted)" }} />
              </button>
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                <input
                  type="checkbox"
                  checked={form.Azienda}
                  onChange={(e) => setForm((f) => ({ ...f, Azienda: e.target.checked }))}
                  className="w-4 h-4 rounded"
                />
                È un&apos;azienda
              </label>

              {form.Azienda && (
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                    Ragione Sociale
                  </label>
                  <input
                    type="text"
                    value={form.Ragione_Sociale}
                    onChange={(e) => setForm((f) => ({ ...f, Ragione_Sociale: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl text-sm"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  ["Nome", "Nome", "text"],
                  ["Email", "Email", "email"],
                  ["Telefono", "Telefono", "tel"],
                  ["Via", "Indirizzo", "text"],
                  ["Citta", "Città", "text"],
                  ["CAP", "CAP", "text"],
                  ["Codice_Fiscale", "Codice Fiscale", "text"],
                  ["Partita_Iva", "Partita IVA", "text"],
                  ["PEC", "PEC", "email"],
                ] as [keyof NuovoClienteForm, string, string][]).map(([field, label, type]) => (
                  <div key={field}>
                    <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                      {label}
                    </label>
                    <input
                      type={type}
                      value={form[field] as string}
                      onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl text-sm"
                      style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}
              >
                Annulla
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                <Check size={14} />
                {saving ? "Salvataggio…" : "Crea cliente"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
            Clienti
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "Caricamento…" : `${filtered.length} clienti`}
          </p>
        </div>
        <button
          onClick={() => { setForm(emptyForm()); setShowModal(true); }}
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl transition-colors flex-shrink-0"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
        >
          <Plus size={16} />
          Nuovo cliente
        </button>
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per nome, email, telefono..."
              className="w-full pl-9 pr-4 py-2 rounded-xl text-sm"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
            />
          </div>
          {search && (
            <button
              onClick={() => setSearch("")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}
            >
              <X size={14} /> Azzera
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: "var(--bg-primary)" }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-2 py-12 text-center text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
            Nessun cliente trovato.
          </div>
        ) : (
          <>
            {/* Mobile: lista a card (la tabella su schermo stretto tagliava le informazioni) */}
            <div className="md:hidden space-y-2.5">
              {filtered.map((c) => (
                <Link
                  key={c.id}
                  href={`/clienti/${c.id}`}
                  className="block rounded-xl p-3.5 transition-colors active:bg-[#F1F4F8]"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                        {nomeDisplay(c)}
                      </p>
                      {c.Tipo && (
                        <span className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>{c.Tipo}</span>
                      )}
                    </div>
                    <Eye size={16} className="flex-shrink-0 mt-0.5" style={{ color: "var(--text-muted)" }} />
                  </div>
                  <div className="mt-2 space-y-1" style={{ fontFamily: "var(--font-montserrat)" }}>
                    <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                      <Mail size={12} className="flex-shrink-0" style={{ color: "var(--text-muted)" }} />
                      <span className="truncate">{c.Email || "—"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                      <Phone size={12} className="flex-shrink-0" style={{ color: "var(--text-muted)" }} />
                      <span className="truncate">{c.Telefono || "—"}</span>
                    </div>
                    {c.Partita_Iva && (
                      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                        <span className="text-[10px] font-semibold uppercase tracking-wider flex-shrink-0" style={{ color: "var(--text-muted)" }}>P.IVA</span>
                        <span className="truncate">{c.Partita_Iva}</span>
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>

            {/* Desktop: tabella */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Nome / Ragione Sociale", "Telefono", "Email", "P.IVA", ""].map((h) => (
                      <th
                        key={h}
                        className="text-left pb-3 px-2 text-xs font-semibold uppercase tracking-wider"
                        style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="hover:bg-[#F1F4F8] transition-colors cursor-pointer" style={{ borderBottom: "1px solid var(--border)" }}>
                      <td className="px-2 py-3 font-semibold" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                        <div>{nomeDisplay(c)}</div>
                        {c.Tipo && (
                          <span className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>{c.Tipo}</span>
                        )}
                      </td>
                      <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {c.Telefono || "—"}
                      </td>
                      <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {c.Email || "—"}
                      </td>
                      <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {c.Partita_Iva || "—"}
                      </td>
                      <td className="px-2 py-3">
                        <Link
                          href={`/clienti/${c.id}`}
                          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors hover:bg-[#F1F4F8]"
                          style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)", border: "1px solid var(--border)" }}
                        >
                          <Eye size={13} />
                          Visualizza
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
