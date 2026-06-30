"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
  collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc,
  doc, limit, Timestamp, serverTimestamp,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Plus, Pencil, Trash2, Search, X, Check, ChevronDown, Loader2 } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import toast from "react-hot-toast";
import type { Promozione } from "@/lib/types";
import { searchProdotti } from "@/lib/algolia";

type PromozioneFS = Promozione & { _stato: "Attiva" | "Scaduta" | "In bozza" };

function derivaStato(p: Promozione): "Attiva" | "Scaduta" | "In bozza" {
  if (!p.Attiva) return "In bozza";
  const scad = p.Scadenza instanceof Timestamp ? p.Scadenza.toDate() : new Date(0);
  return scad > new Date() ? "Attiva" : "Scaduta";
}

function formatScadenza(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function clientiLabel(refs: DocumentReference[]): string {
  return refs.length > 0 ? `${refs.length} clienti` : "Tutti";
}

const statoVariant: Record<string, "success" | "error" | "neutral"> = {
  Attiva: "success",
  Scaduta: "error",
  "In bozza": "neutral",
};

const STAGIONI = ["Estive", "Invernali", "4 Stagioni"];
const RAGGI = ["12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "22.5", "24.5"];

type FormState = {
  fisso: boolean;
  attiva: boolean;
  brand: string[];
  stagioni: string[];
  raggi: string[];
  clientiIds: string[];
  importo: string;
  scadenza: string; // "YYYY-MM-DDTHH:mm"
};

const FORM_DEFAULT: FormState = {
  fisso: true,
  attiva: true,
  brand: [],
  stagioni: [],
  raggi: [],
  clientiIds: [],
  importo: "",
  scadenza: "",
};

type ClienteOption = { id: string; label: string; ref: DocumentReference };

// Compact searchable dropdown for large lists (e.g. brands)
function SearchableMultiSelect({
  label, options, selected, onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options;

  return (
    <div ref={wrapRef}>
      <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
        {label}{selected.length > 0 && ` · ${selected.length} selezionati`}
      </label>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {selected.map((s) => (
            <span key={s} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}>
              {s}
              <button type="button" onClick={() => onToggle(s)} className="hover:opacity-70">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-left"
        style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: selected.length ? "#111" : "#9ca3af" }}
      >
        <span>{selected.length === 0 ? "Seleziona brand…" : `${selected.length} brand selezionati`}</span>
        <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", flexShrink: 0 }} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="relative z-40">
          <div className="absolute top-1 left-0 right-0 rounded-xl overflow-hidden"
            style={{ background: "#fff", border: "1px solid #e5e7eb", boxShadow: "var(--shadow-md)" }}>
            <div className="px-2 pt-2">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cerca brand…"
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)" }}
              />
            </div>
            <div className="overflow-y-auto max-h-48 py-1">
              {filtered.length === 0 && (
                <p className="px-3 py-2 text-xs" style={{ color: "#9ca3af" }}>Nessun brand trovato</p>
              )}
              {filtered.map((o) => {
                const active = selected.includes(o);
                return (
                  <button key={o} type="button"
                    onMouseDown={(e) => { e.preventDefault(); onToggle(o); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[#FFFDF0] transition-colors"
                    style={{ background: active ? "#FFF8DC" : "transparent", fontFamily: "var(--font-montserrat)" }}
                  >
                    <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                      style={{ background: active ? "#FFC803" : "#f3f4f6", border: `1px solid ${active ? "#FFC803" : "#e5e7eb"}` }}>
                      {active && <Check size={10} />}
                    </span>
                    <span style={{ color: "#111" }}>{o}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MultiSelect({
  label, options, selected, onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
        {label}
      </label>
      <div className="flex flex-wrap gap-1.5 p-2 rounded-xl min-h-10" style={{ border: "1px solid #e5e7eb", background: "#f9fafb" }}>
        {options.map((o) => {
          const active = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => onToggle(o)}
              className="px-3 py-1 rounded-full text-xs font-semibold transition-colors"
              style={{
                background: active ? "#FFC803" : "#fff",
                border: `1px solid ${active ? "#FFC803" : "#e5e7eb"}`,
                color: "#111",
                fontFamily: "var(--font-montserrat)",
              }}
            >
              {active && <Check size={10} className="inline mr-1" />}{o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ClientiDropdown({
  selected, options, search, onSearch, onToggle,
}: {
  selected: string[];
  options: ClienteOption[];
  search: string;
  onSearch: (v: string) => void;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  return (
    <div ref={wrapRef}>
      <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
        Clienti inclusi ({selected.length > 0 ? `${selected.length} selezionati` : "tutti"})
      </label>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {options.filter((c) => selected.includes(c.id)).map((c) => (
            <span key={c.id} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}>
              {c.label}
              <button type="button" onClick={() => onToggle(c.id)} className="hover:opacity-70">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-left"
        style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: selected.length ? "#111" : "#9ca3af" }}
      >
        <span>{selected.length === 0 ? "Seleziona clienti…" : `${selected.length} clienti selezionati`}</span>
        <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", flexShrink: 0 }} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="relative z-40">
          <div className="absolute top-1 left-0 right-0 rounded-xl overflow-hidden"
            style={{ background: "#fff", border: "1px solid #e5e7eb", boxShadow: "var(--shadow-md)" }}>
            <div className="px-2 pt-2">
              <input
                autoFocus
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Cerca cliente…"
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)" }}
              />
            </div>
            <div className="overflow-y-auto max-h-48 py-1">
              {options.length === 0 && (
                <p className="px-3 py-2 text-xs" style={{ color: "#9ca3af" }}>Nessun cliente trovato</p>
              )}
              {options.slice(0, 80).map((c) => {
                const sel = selected.includes(c.id);
                return (
                  <button key={c.id} type="button"
                    onMouseDown={(e) => { e.preventDefault(); onToggle(c.id); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[#FFFDF0] transition-colors"
                    style={{ background: sel ? "#FFF8DC" : "transparent", fontFamily: "var(--font-montserrat)" }}
                  >
                    <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                      style={{ background: sel ? "#FFC803" : "#f3f4f6", border: `1px solid ${sel ? "#FFC803" : "#e5e7eb"}` }}>
                      {sel && <Check size={10} />}
                    </span>
                    <span style={{ color: "#111" }}>{c.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PromozioniPage() {
  const [promozioni, setPromozioni] = useState<PromozioneFS[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"attive" | "archiviate">("attive");
  const [search, setSearch] = useState("");

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(FORM_DEFAULT);
  const [saving, setSaving] = useState(false);

  // Options for form
  const [brandList, setBrandList] = useState<string[]>([]);
  const [clientiList, setClientiList] = useState<ClienteOption[]>([]);
  const [clienteSearch, setClienteSearch] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(false);

  async function loadPromozioni() {
    try {
      const snap = await getDocs(
        query(collection(db, "Promozione"), orderBy("Scadenza", "desc"), limit(200))
      );
      const docs = snap.docs.map((d) => {
        const raw = { id: d.id, ...d.data() } as Promozione;
        return { ...raw, _stato: derivaStato(raw) } satisfies PromozioneFS;
      });
      setPromozioni(docs);
    } catch (err) {
      console.error(err);
      toast.error("Errore nel caricamento delle promozioni");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPromozioni(); }, []);

  async function openModal(promo?: PromozioneFS) {
    setLoadingOptions(true);
    setShowModal(true);
    if (promo) {
      setEditId(promo.id);
      const importoVal = promo.Importo ?? promo.Sconto ?? 0;
      const scad = promo.Scadenza?.toDate?.();
      setForm({
        fisso: promo.Fisso ?? true,
        attiva: promo.Attiva ?? true,
        brand: promo.Brand_Nome ?? [],
        stagioni: promo.Stagione ?? [],
        raggi: promo.Raggio ?? [],
        clientiIds: [], // loaded below
        importo: importoVal ? String(importoVal) : "",
        scadenza: scad ? scad.toISOString().slice(0, 16) : "",
      });
    } else {
      setEditId(null);
      setForm(FORM_DEFAULT);
    }

    // Load brands + clienti in parallel
    try {
      const [brandRes, clientiSnap] = await Promise.all([
        searchProdotti({ withFacets: true, hitsPerPage: 0, soloDisponibili: false })
          .then((r) => r.facets?.Marca ? Object.keys(r.facets.Marca).sort() : []),
        getDocs(query(collection(db, "Clienti"), limit(500))),
      ]);
      setBrandList(brandRes);
      const opts: ClienteOption[] = clientiSnap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        const label = data.Ragione_Sociale
          ? String(data.Ragione_Sociale)
          : [data.Nome, data.Cognome].filter(Boolean).join(" ") || d.id;
        return { id: d.id, label, ref: doc(db, "Clienti", d.id) };
      });
      opts.sort((a, b) => a.label.localeCompare(b.label, "it"));
      setClientiList(opts);

      // If editing, map Clienti refs to ids
      if (promo?.Clienti?.length) {
        const ids = promo.Clienti.map((r) => r.id);
        setForm((f) => ({ ...f, clientiIds: ids }));
      }
    } catch {
      toast.error("Errore nel caricamento opzioni");
    } finally {
      setLoadingOptions(false);
    }
  }

  function closeModal() {
    setShowModal(false);
    setEditId(null);
    setForm(FORM_DEFAULT);
    setClienteSearch("");
  }

  function toggleArr<T>(arr: T[], val: T): T[] {
    return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
  }

  async function handleSave() {
    if (!form.scadenza) { toast.error("Inserisci la data di scadenza"); return; }
    const importoNum = parseFloat(form.importo.replace(",", "."));
    if (isNaN(importoNum) || importoNum <= 0) { toast.error("Inserisci un importo valido"); return; }
    // La percentuale è una frazione (0.15 = 15%): deve stare in (0, 1].
    if (!form.fisso && importoNum > 1) {
      toast.error("La percentuale dev'essere una frazione: es. 0.15 = 15% (max 1)");
      return;
    }

    setSaving(true);
    try {
      const scadenza = Timestamp.fromDate(new Date(form.scadenza));
      const clientiRefs = form.clientiIds.map((cid) => doc(db, "Clienti", cid));

      const payload = {
        Fisso: form.fisso,
        Brand_Nome: form.brand,
        Stagione: form.stagioni,
        Raggio: form.raggi,
        Clienti: clientiRefs,
        Importo: importoNum,
        Scadenza: scadenza,
        Attiva: form.attiva,
      };

      if (editId) {
        await updateDoc(doc(db, "Promozione", editId), payload);
        toast.success("Promozione aggiornata");
      } else {
        await addDoc(collection(db, "Promozione"), { ...payload, createdAt: serverTimestamp() });
        toast.success("Promozione creata");
      }

      closeModal();
      setLoading(true);
      await loadPromozioni();
    } catch (err) {
      console.error(err);
      toast.error("Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Eliminare questa promozione?")) return;
    try {
      await deleteDoc(doc(db, "Promozione", id));
      setPromozioni((prev) => prev.filter((p) => p.id !== id));
      toast.success("Promozione eliminata");
    } catch {
      toast.error("Errore nell'eliminazione");
    }
  }

  const filtered = useMemo(() => {
    const byTab = promozioni.filter((p) =>
      tab === "attive" ? p._stato !== "Scaduta" : p._stato === "Scaduta"
    );
    if (!search) return byTab;
    const q = search.toLowerCase();
    return byTab.filter((p) =>
      (p.Brand_Nome ?? []).join(" ").toLowerCase().includes(q)
    );
  }, [promozioni, tab, search]);

  const clientiFiltrati = useMemo(() => {
    if (!clienteSearch) return clientiList;
    const q = clienteSearch.toLowerCase();
    return clientiList.filter((c) => c.label.toLowerCase().includes(q));
  }, [clientiList, clienteSearch]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Promozioni</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "Caricamento…" : `${filtered.length} promozioni`}
          </p>
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-80 hover:brightness-[1.04] active:scale-[.98]"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}
        >
          <Plus size={15} /> Nuova promozione
        </button>
      </div>

      <Card padding="sm">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
            {(["attive", "archiviate"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="px-4 py-1.5 rounded-lg text-sm font-semibold capitalize transition-colors"
                style={{
                  fontFamily: "var(--font-montserrat)",
                  background: tab === t ? "var(--brand)" : "transparent",
                  color: tab === t ? "#111" : "var(--text-secondary)",
                }}
              >
                {t === "attive" ? "Attive" : "Archiviate"}
              </button>
            ))}
          </div>

          <div className="flex-1 min-w-[150px] relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per brand…"
              className="w-full pl-8 pr-4 py-2 rounded-xl text-sm outline-none"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }}
            />
          </div>

          {search && (
            <button
              onClick={() => setSearch("")}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Lista promozioni */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: "var(--bg-primary)" }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
            Nessuna promozione trovata.
          </div>
        ) : (
          <>
            {/* Mobile: lista a card (la tabella su schermo stretto tagliava le colonne) */}
            <div className="md:hidden space-y-2.5">
              {filtered.map((p) => {
                const importoVal = p.Importo ?? p.Sconto ?? 0;
                return (
                  <div
                    key={p.id}
                    className="rounded-xl p-3.5"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
                          {p.Fisso ? `€ ${importoVal}` : `${importoVal}%`}
                        </span>
                        <span className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                          {p.Fisso ? "importo fisso" : "percentuale"}
                        </span>
                      </div>
                      <Badge variant={statoVariant[p._stato] ?? "neutral"}>{p._stato}</Badge>
                    </div>

                    <div className="flex flex-wrap gap-1 mb-2">
                      {(p.Brand_Nome ?? []).length > 0 ? (
                        p.Brand_Nome.map((b) => (
                          <span key={b} className="px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{ background: "#f3f4f6", color: "#374151" }}>{b}</span>
                        ))
                      ) : (
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>Tutte le marche</span>
                      )}
                    </div>

                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                      <span>{clientiLabel(p.Clienti ?? [])}</span>
                      <span style={{ color: "var(--text-muted)" }}>·</span>
                      <span>Scad. {formatScadenza(p.Scadenza)}</span>
                    </div>

                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={() => openModal(p)}
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg"
                        style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                      >
                        <Pencil size={13} /> Modifica
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="flex items-center justify-center px-3 py-2 rounded-lg"
                        style={{ color: "#DC2626", border: "1px solid var(--border)" }}
                        aria-label="Elimina"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop: tabella */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                    {["Brand applicati", "Tipo sconto", "Sconto", "Clienti inclusi", "Scadenza", "Stato", ""].map((h, i) => (
                      <th key={i} className="pb-2.5 pr-4 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const importoVal = p.Importo ?? p.Sconto ?? 0;
                    return (
                      <tr key={p.id} className="border-t hover:bg-[#FFFDF0] transition-colors" style={{ borderColor: "var(--border)" }}>
                        <td className="py-3 pr-4">
                          <div className="flex flex-wrap gap-1">
                            {(p.Brand_Nome ?? []).length > 0 ? (
                              p.Brand_Nome.map((b) => (
                                <span key={b} className="px-2 py-0.5 rounded-full text-xs font-medium"
                                  style={{ background: "#f3f4f6", color: "#374151" }}>{b}</span>
                              ))
                            ) : (
                              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Tutte le marche</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-sm" style={{ color: "var(--text-secondary)" }}>
                          {p.Fisso ? "€ fisso" : "% percentuale"}
                        </td>
                        <td className="py-3 pr-4 text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                          {p.Fisso ? `€ ${importoVal}` : `${importoVal}%`}
                        </td>
                        <td className="py-3 pr-4 text-sm" style={{ color: "var(--text-secondary)" }}>
                          {clientiLabel(p.Clienti ?? [])}
                        </td>
                        <td className="py-3 pr-4 text-sm" style={{ color: "var(--text-secondary)" }}>
                          {formatScadenza(p.Scadenza)}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge variant={statoVariant[p._stato] ?? "neutral"}>{p._stato}</Badge>
                        </td>
                        <td className="py-3">
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => openModal(p)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                              style={{ border: "1px solid var(--border)" }}>
                              <Pencil size={13} style={{ color: "var(--text-secondary)" }} />
                            </button>
                            <button onClick={() => handleDelete(p.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                              style={{ border: "1px solid var(--border)" }}>
                              <Trash2 size={13} style={{ color: "#DC2626" }} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* ── Modal Nuova/Modifica Promozione ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col"
            style={{ background: "#fff", maxHeight: "90vh", boxShadow: "var(--shadow-xl)" }}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4"
              style={{ borderBottom: "1px solid #e5e7eb" }}>
              <h2 className="text-lg font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
                {editId ? "Modifica promozione" : "Nuova promozione"}
              </h2>
              <button onClick={closeModal} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            {loadingOptions ? (
              <div className="flex items-center justify-center py-16 gap-3">
                <Loader2 size={20} className="animate-spin" style={{ color: "#FFC803" }} />
                <span className="text-sm" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>Caricamento…</span>
              </div>
            ) : (
              <div className="overflow-y-auto px-6 py-5 space-y-5">

                {/* Tipo sconto */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                    Tipo sconto
                  </label>
                  <div className="flex gap-2">
                    {[
                      { label: "Importo fisso (€)", value: true },
                      { label: "Percentuale (%)", value: false },
                    ].map((opt) => (
                      <button
                        key={String(opt.value)}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, fisso: opt.value }))}
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex-1"
                        style={{
                          background: form.fisso === opt.value ? "#FFC803" : "#f9fafb",
                          border: `1.5px solid ${form.fisso === opt.value ? "#FFC803" : "#e5e7eb"}`,
                          color: "#111",
                          fontFamily: "var(--font-montserrat)",
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Importo */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                    {form.fisso ? "Importo sconto (€)" : "Percentuale sconto (es. 0.15 = 15%)"}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.importo}
                    onChange={(e) => setForm((f) => ({ ...f, importo: e.target.value }))}
                    placeholder={form.fisso ? "es. 5.00" : "es. 0.15"}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                    style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)" }}
                  />
                </div>

                {/* Scadenza */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                    Data di scadenza
                  </label>
                  <input
                    type="datetime-local"
                    value={form.scadenza}
                    onChange={(e) => setForm((f) => ({ ...f, scadenza: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                    style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)" }}
                  />
                </div>

                {/* Stato attiva/bozza — evita che modificare una promo la ripubblichi per sbaglio */}
                <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl cursor-pointer"
                  style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)" }}>
                  <div>
                    <span className="block text-xs font-bold uppercase tracking-widest" style={{ color: "#374151" }}>
                      Promozione attiva
                    </span>
                    <span className="block text-[11px]" style={{ color: "#9ca3af" }}>
                      Disattiva per salvarla come bozza senza applicarla ai prezzi
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.attiva}
                    onChange={(e) => setForm((f) => ({ ...f, attiva: e.target.checked }))}
                    className="w-5 h-5 flex-shrink-0 cursor-pointer"
                    style={{ accentColor: "#FFC803" }}
                  />
                </label>

                {/* Brand */}
                {brandList.length > 0 && (
                  <SearchableMultiSelect
                    label="Brand applicati (lascia vuoto = tutti)"
                    options={brandList}
                    selected={form.brand}
                    onToggle={(v) => setForm((f) => ({ ...f, brand: toggleArr(f.brand, v) }))}
                  />
                )}

                {/* Stagione */}
                <MultiSelect
                  label="Stagioni (lascia vuoto = tutte)"
                  options={STAGIONI}
                  selected={form.stagioni}
                  onToggle={(v) => setForm((f) => ({ ...f, stagioni: toggleArr(f.stagioni, v) }))}
                />

                {/* Raggio */}
                <MultiSelect
                  label="Raggi pneumatico (lascia vuoto = tutti)"
                  options={RAGGI}
                  selected={form.raggi}
                  onToggle={(v) => setForm((f) => ({ ...f, raggi: toggleArr(f.raggi, v) }))}
                />

                {/* Clienti */}
                <ClientiDropdown
                  selected={form.clientiIds}
                  options={clientiFiltrati}
                  search={clienteSearch}
                  onSearch={setClienteSearch}
                  onToggle={(id) => setForm((f) => ({ ...f, clientiIds: toggleArr(f.clientiIds, id) }))}
                />

              </div>
            )}

            {/* Modal footer */}
            <div className="px-6 py-4 flex justify-end gap-2"
              style={{ borderTop: "1px solid #e5e7eb" }}>
              <button
                onClick={closeModal}
                className="px-5 py-2 rounded-xl text-sm font-semibold"
                style={{ background: "#f9fafb", border: "1px solid #e5e7eb", color: "#374151", fontFamily: "var(--font-montserrat)" }}
              >
                Annulla
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all hover:opacity-80 disabled:opacity-60 hover:brightness-[1.04] active:scale-[.98] disabled:active:scale-100"
                style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? "Salvataggio…" : "Salva"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
