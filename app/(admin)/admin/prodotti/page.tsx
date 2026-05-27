"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Package, Search, Eye, Pencil, Trash2, X, ChevronLeft, ChevronRight, Plus, Save, Loader2 } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import StatCard from "@/components/ui/StatCard";
import toast from "react-hot-toast";
import {
  searchProdotti, stockTotale, formatMisura, pfuDaDiametro,
  type ProdottoHit,
} from "@/lib/algolia";
import { doc, addDoc, updateDoc, deleteDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";

const PAGE_SIZE = 50;

function formatEuro(n: number | undefined | null) {
  return (n ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

const stagioneVariant: Record<string, "brand" | "neutral" | "success"> = {
  Estive: "brand",
  Invernali: "neutral",
  "4-Stagioni": "success",
};

// ---------------------------------------------------------------------------
// Tipi pannello
// ---------------------------------------------------------------------------
type PanelMode = "create" | "edit" | "view";

interface FormState {
  Marca: string;
  Modello: string;
  Stagione: "Estive" | "Invernali" | "4-Stagioni" | "";
  Larghezza: string;
  Altezza: string;
  Diametro: string;
  Indice_Velocita: string;
  Indice_Carico: string;
  Immagine: string;
  EAN: string;
  SKU: string;
  PFU: string;
  Prezzo_Gommista: string;
  Prezzo_Grossista: string;
  Prezzo_Privato: string;
  Prezzo_T24: string;
  Prezzo_Acquisto: string;
  Stock_Nola: string;
  Stock_Nola_2: string;
  Stock_Volla: string;
  Stock_Roma: string;
  Stock_Portici: string;
  Stock_OCP: string;
  Stock_T24: string;
}

function emptyForm(): FormState {
  return {
    Marca: "", Modello: "", Stagione: "",
    Larghezza: "", Altezza: "", Diametro: "",
    Indice_Velocita: "", Indice_Carico: "",
    Immagine: "", EAN: "", SKU: "", PFU: "",
    Prezzo_Gommista: "", Prezzo_Grossista: "", Prezzo_Privato: "",
    Prezzo_T24: "", Prezzo_Acquisto: "",
    Stock_Nola: "", Stock_Nola_2: "", Stock_Volla: "",
    Stock_Roma: "", Stock_Portici: "", Stock_OCP: "", Stock_T24: "",
  };
}

function prodottoToForm(p: ProdottoHit): FormState {
  return {
    Marca: p.Marca ?? "",
    Modello: p.Modello ?? "",
    Stagione: p.Stagione ?? "",
    Larghezza: p.Larghezza != null ? String(p.Larghezza) : "",
    Altezza: p.Altezza != null ? String(p.Altezza) : "",
    Diametro: p.Diametro != null ? String(p.Diametro) : "",
    Indice_Velocita: p.Indice_Velocita ?? "",
    Indice_Carico: p.Indice_Carico ?? "",
    Immagine: p.Immagine ?? "",
    EAN: p.EAN ?? "",
    SKU: p.SKU ?? "",
    PFU: p.PFU != null ? String(p.PFU) : "",
    Prezzo_Gommista: p.Prezzo_Gommista != null ? String(p.Prezzo_Gommista) : "",
    Prezzo_Grossista: p.Prezzo_Grossista != null ? String(p.Prezzo_Grossista) : "",
    Prezzo_Privato: p.Prezzo_Privato != null ? String(p.Prezzo_Privato) : "",
    Prezzo_T24: p.Prezzo_T24 != null ? String(p.Prezzo_T24) : "",
    Prezzo_Acquisto: p.Prezzo_Acquisto != null ? String(p.Prezzo_Acquisto) : "",
    Stock_Nola: p.Stock_Nola != null ? String(p.Stock_Nola) : "",
    Stock_Nola_2: p.Stock_Nola_2 != null ? String(p.Stock_Nola_2) : "",
    Stock_Volla: p.Stock_Volla != null ? String(p.Stock_Volla) : "",
    Stock_Roma: p.Stock_Roma != null ? String(p.Stock_Roma) : "",
    Stock_Portici: p.Stock_Portici != null ? String(p.Stock_Portici) : "",
    Stock_OCP: p.Stock_OCP != null ? String(p.Stock_OCP) : "",
    Stock_T24: p.Stock_T24 != null ? String(p.Stock_T24) : "",
  };
}

// ---------------------------------------------------------------------------
// Componenti form helpers
// ---------------------------------------------------------------------------
const inputStyle = {
  background: "var(--bg-primary)",
  border: "1px solid var(--border)",
  fontFamily: "var(--font-montserrat)",
  color: "var(--text-primary)",
};

function FieldLabel({ children, red }: { children: React.ReactNode; red?: boolean }) {
  return (
    <label
      className="block text-[10px] font-bold uppercase tracking-widest mb-1"
      style={{ color: red ? "#EF4444" : "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
    >
      {children}
    </label>
  );
}

function TextInput({
  value, onChange, placeholder, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full px-3 py-2 rounded-xl text-sm outline-none disabled:opacity-60"
      style={inputStyle}
    />
  );
}

function NumberInput({
  value, onChange, placeholder, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full px-3 py-2 rounded-xl text-sm outline-none disabled:opacity-60"
      style={inputStyle}
    />
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="pt-4 pb-2 text-[11px] font-bold uppercase tracking-widest border-t"
      style={{ borderColor: "var(--border)", color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side Panel Component
// ---------------------------------------------------------------------------
interface SidePanelProps {
  mode: PanelMode;
  form: FormState;
  saving: boolean;
  prezziExpanded: boolean;
  onTogglePrezzi: () => void;
  onChange: (field: keyof FormState, value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

function SidePanel({
  mode, form, saving, prezziExpanded, onTogglePrezzi, onChange, onSave, onClose,
}: SidePanelProps) {
  const readonly = mode === "view";
  const title =
    mode === "create" ? "Nuovo prodotto" :
    mode === "edit"   ? "Modifica prodotto" :
                        "Dettaglio prodotto";

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.45)" }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col"
        style={{
          width: 480,
          background: "var(--bg-secondary)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.18)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <h2
            className="text-base font-bold"
            style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
            style={{ border: "1px solid var(--border)" }}
          >
            <X size={15} style={{ color: "var(--text-secondary)" }} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">

          {/* — DATI BASE — */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Marca *</FieldLabel>
              <TextInput value={form.Marca} onChange={(v) => onChange("Marca", v)} placeholder="es. Michelin" disabled={readonly} />
            </div>
            <div>
              <FieldLabel>Modello *</FieldLabel>
              <TextInput value={form.Modello} onChange={(v) => onChange("Modello", v)} placeholder="es. Primacy 4" disabled={readonly} />
            </div>
          </div>

          <div>
            <FieldLabel>Stagione *</FieldLabel>
            <select
              value={form.Stagione}
              onChange={(e) => onChange("Stagione", e.target.value)}
              disabled={readonly}
              className="w-full px-3 py-2 rounded-xl text-sm outline-none disabled:opacity-60"
              style={inputStyle}
            >
              <option value="">Seleziona stagione</option>
              <option value="Estive">Estive</option>
              <option value="Invernali">Invernali</option>
              <option value="4-Stagioni">4-Stagioni</option>
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <FieldLabel>Larghezza *</FieldLabel>
              <NumberInput value={form.Larghezza} onChange={(v) => onChange("Larghezza", v)} placeholder="205" disabled={readonly} />
            </div>
            <div>
              <FieldLabel>Altezza *</FieldLabel>
              <NumberInput value={form.Altezza} onChange={(v) => onChange("Altezza", v)} placeholder="55" disabled={readonly} />
            </div>
            <div>
              <FieldLabel>Diametro *</FieldLabel>
              <NumberInput value={form.Diametro} onChange={(v) => onChange("Diametro", v)} placeholder="16" disabled={readonly} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Indice Velocità</FieldLabel>
              <TextInput value={form.Indice_Velocita} onChange={(v) => onChange("Indice_Velocita", v)} placeholder="H, V, W…" disabled={readonly} />
            </div>
            <div>
              <FieldLabel>Indice Carico</FieldLabel>
              <TextInput value={form.Indice_Carico} onChange={(v) => onChange("Indice_Carico", v)} placeholder="91, 94…" disabled={readonly} />
            </div>
          </div>

          <div>
            <FieldLabel>Immagine (URL)</FieldLabel>
            <TextInput value={form.Immagine} onChange={(v) => onChange("Immagine", v)} placeholder="https://…" disabled={readonly} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>EAN</FieldLabel>
              <TextInput value={form.EAN} onChange={(v) => onChange("EAN", v)} placeholder="3528704753849" disabled={readonly} />
            </div>
            <div>
              <FieldLabel>SKU</FieldLabel>
              <TextInput value={form.SKU} onChange={(v) => onChange("SKU", v)} placeholder="MIC-001" disabled={readonly} />
            </div>
          </div>

          <div>
            <FieldLabel>PFU (lascia vuoto per calcolo automatico da diametro)</FieldLabel>
            <NumberInput value={form.PFU} onChange={(v) => onChange("PFU", v)} placeholder={form.Diametro ? String(pfuDaDiametro(Number(form.Diametro))) : "auto"} disabled={readonly} />
          </div>

          {/* — PREZZI (collassabile) — */}
          <div>
            <button
              type="button"
              onClick={onTogglePrezzi}
              className="flex items-center gap-2 w-full pt-4 pb-2 text-[11px] font-bold uppercase tracking-widest border-t text-left"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)", fontFamily: "var(--font-montserrat)", background: "transparent" }}
            >
              <span>{prezziExpanded ? "▾" : "▸"}</span>
              Prezzi
            </button>

            {prezziExpanded && (
              <div className="space-y-3 mt-1">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel>Prezzo Gommista</FieldLabel>
                    <NumberInput value={form.Prezzo_Gommista} onChange={(v) => onChange("Prezzo_Gommista", v)} placeholder="0.00" disabled={readonly} />
                  </div>
                  <div>
                    <FieldLabel>Prezzo Grossista</FieldLabel>
                    <NumberInput value={form.Prezzo_Grossista} onChange={(v) => onChange("Prezzo_Grossista", v)} placeholder="0.00" disabled={readonly} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel>Prezzo Privato</FieldLabel>
                    <NumberInput value={form.Prezzo_Privato} onChange={(v) => onChange("Prezzo_Privato", v)} placeholder="0.00" disabled={readonly} />
                  </div>
                  <div>
                    <FieldLabel>Prezzo T24</FieldLabel>
                    <NumberInput value={form.Prezzo_T24} onChange={(v) => onChange("Prezzo_T24", v)} placeholder="0.00" disabled={readonly} />
                  </div>
                </div>
                <div>
                  <FieldLabel red>Prezzo acquisto (riservato admin)</FieldLabel>
                  <NumberInput value={form.Prezzo_Acquisto} onChange={(v) => onChange("Prezzo_Acquisto", v)} placeholder="0.00" disabled={readonly} />
                </div>
              </div>
            )}
          </div>

          {/* — STOCK — */}
          <SectionHeading>Stock per deposito</SectionHeading>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Stock Nola</FieldLabel>
              <NumberInput value={form.Stock_Nola} onChange={(v) => onChange("Stock_Nola", v)} placeholder="0" disabled={readonly} />
            </div>
            <div>
              <FieldLabel>Stock Nola 2</FieldLabel>
              <NumberInput value={form.Stock_Nola_2} onChange={(v) => onChange("Stock_Nola_2", v)} placeholder="0" disabled={readonly} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Stock Volla</FieldLabel>
              <NumberInput value={form.Stock_Volla} onChange={(v) => onChange("Stock_Volla", v)} placeholder="0" disabled={readonly} />
            </div>
            <div>
              <FieldLabel>Stock Roma</FieldLabel>
              <NumberInput value={form.Stock_Roma} onChange={(v) => onChange("Stock_Roma", v)} placeholder="0" disabled={readonly} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Stock Portici</FieldLabel>
              <NumberInput value={form.Stock_Portici} onChange={(v) => onChange("Stock_Portici", v)} placeholder="0" disabled={readonly} />
            </div>
            <div>
              <FieldLabel>Stock OCP</FieldLabel>
              <NumberInput value={form.Stock_OCP} onChange={(v) => onChange("Stock_OCP", v)} placeholder="0" disabled={readonly} />
            </div>
          </div>

          <div>
            <FieldLabel>Stock T24 (dropship 48/72h)</FieldLabel>
            <NumberInput value={form.Stock_T24} onChange={(v) => onChange("Stock_T24", v)} placeholder="0" disabled={readonly} />
          </div>

        </div>

        {/* Footer */}
        {!readonly && (
          <div
            className="px-6 py-4 flex items-center justify-end gap-3 flex-shrink-0"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold hover:opacity-70 transition-opacity"
              style={{
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-montserrat)",
              }}
            >
              Annulla
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold hover:opacity-80 transition-opacity disabled:opacity-50"
              style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {mode === "create" ? "Crea prodotto" : "Salva modifiche"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function ProdottiPage() {
  const [tutti, setTutti] = useState<ProdottoHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [marca, setMarca] = useState("");
  const [stagione, setStagione] = useState("");
  const [soloDisponibili, setSoloDisponibili] = useState(false);
  const [page, setPage] = useState(0);

  // Panel state
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [prezziExpanded, setPrezziExpanded] = useState(true);

  // ---------------------------------------------------------------------------
  // Caricamento lista
  // ---------------------------------------------------------------------------
  const loadProdotti = useCallback(() => {
    return searchProdotti({ query: "", soloDisponibili: false, hitsPerPage: 1000, page: 0 })
      .then((r) => setTutti(r.hits as ProdottoHit[]))
      .catch(() => toast.error("Errore nel caricamento prodotti"));
  }, []);

  useEffect(() => {
    loadProdotti().finally(() => setLoading(false));
  }, [loadProdotti]);

  // ---------------------------------------------------------------------------
  // Filtri / paginazione
  // ---------------------------------------------------------------------------
  const marcheUniche = useMemo(
    () => [...new Set(tutti.map((p) => p.Marca).filter(Boolean))].sort(),
    [tutti]
  );

  const filtered = useMemo(() => {
    setPage(0);
    return tutti.filter((p) => {
      if (search) {
        const q = search.toLowerCase();
        if (![p.Marca, p.Modello, p.EAN ?? "", p.Titolo ?? ""].join(" ").toLowerCase().includes(q)) return false;
      }
      if (marca && p.Marca !== marca) return false;
      if (stagione && p.Stagione !== stagione) return false;
      if (soloDisponibili && stockTotale(p) === 0) return false;
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutti, search, marca, stagione, soloDisponibili]);

  const paginated = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page]
  );
  const nbPages = Math.ceil(filtered.length / PAGE_SIZE);

  const stats = useMemo(() => {
    const totale = tutti.length;
    const disponibili = tutti.filter((p) => stockTotale(p) > 0).length;
    const esauriti = tutti.filter((p) => stockTotale(p) === 0).length;
    return [
      { label: "Totale prodotti", value: totale,     sub: "in catalogo", icon: <Package size={20} />, accent: "#FFC803" },
      { label: "Disponibili",     value: disponibili, sub: "a magazzino", icon: <Package size={20} />, accent: "#249689" },
      { label: "Esauriti",        value: esauriti,    sub: "stock zero",  icon: <Package size={20} />, accent: "#FF5963" },
      { label: "In promozione",   value: 0,           sub: "scontati",    icon: <Package size={20} />, accent: "#EE8B60" },
    ];
  }, [tutti]);

  const hasFilters = !!(search || marca || stagione || soloDisponibili);

  function reset() {
    setSearch(""); setMarca(""); setStagione(""); setSoloDisponibili(false);
  }

  // ---------------------------------------------------------------------------
  // Panel handlers
  // ---------------------------------------------------------------------------
  function openCreate() {
    setForm(emptyForm());
    setEditingId(null);
    setPanelMode("create");
    setPrezziExpanded(true);
    setPanelOpen(true);
  }

  function openEdit(p: ProdottoHit) {
    setForm(prodottoToForm(p));
    setEditingId(p.objectID);
    setPanelMode("edit");
    setPrezziExpanded(true);
    setPanelOpen(true);
  }

  function openView(p: ProdottoHit) {
    setForm(prodottoToForm(p));
    setEditingId(p.objectID);
    setPanelMode("view");
    setPrezziExpanded(true);
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
    setEditingId(null);
  }

  function handleChange(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  // ---------------------------------------------------------------------------
  // Build Firestore payload
  // ---------------------------------------------------------------------------
  function buildPayload() {
    const diametro = Number(form.Diametro) || 0;
    const pfuManuale = form.PFU !== "" ? Number(form.PFU) : null;
    const pfuCalcolato = pfuManuale != null && !isNaN(pfuManuale) ? pfuManuale : pfuDaDiametro(diametro);

    return {
      Marca: form.Marca.trim(),
      Modello: form.Modello.trim(),
      Stagione: form.Stagione,
      Larghezza: Number(form.Larghezza) || 0,
      Altezza: Number(form.Altezza) || 0,
      Diametro: diametro,
      Indice_Velocita: form.Indice_Velocita.trim(),
      Indice_Carico: form.Indice_Carico.trim(),
      Immagine: form.Immagine.trim(),
      EAN: form.EAN.trim(),
      SKU: form.SKU.trim(),
      PFU: pfuCalcolato,
      Prezzo_Gommista: Number(form.Prezzo_Gommista) || 0,
      Prezzo_Grossista: Number(form.Prezzo_Grossista) || 0,
      Prezzo_Privato: Number(form.Prezzo_Privato) || 0,
      Prezzo_T24: Number(form.Prezzo_T24) || 0,
      ...(form.Prezzo_Acquisto !== "" ? { Prezzo_Acquisto: Number(form.Prezzo_Acquisto) } : {}),
      Stock_Nola: parseInt(form.Stock_Nola) || 0,
      Stock_Nola_2: parseInt(form.Stock_Nola_2) || 0,
      Stock_Volla: parseInt(form.Stock_Volla) || 0,
      Stock_Roma: parseInt(form.Stock_Roma) || 0,
      Stock_Portici: parseInt(form.Stock_Portici) || 0,
      Stock_OCP: parseInt(form.Stock_OCP) || 0,
      Stock_T24: parseInt(form.Stock_T24) || 0,
      T24: (parseInt(form.Stock_T24) || 0) > 0,
    };
  }

  async function handleDelete(objectID: string, marca: string, modello: string) {
    if (!confirm(`Eliminare definitivamente "${marca} ${modello}"? L'operazione non può essere annullata.`)) return;
    try {
      await deleteDoc(doc(db, "Prodotti", objectID));
      setTutti((prev) => prev.filter((p) => p.objectID !== objectID));
      closePanel();
      toast.success("Prodotto eliminato");
    } catch {
      toast.error("Errore nell'eliminazione");
    }
  }

  async function handleSave() {
    if (!form.Marca.trim() || !form.Modello.trim() || !form.Stagione || !form.Larghezza || !form.Altezza || !form.Diametro) {
      toast.error("Compila i campi obbligatori: Marca, Modello, Stagione, Misura");
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();

      if (panelMode === "create") {
        await addDoc(collection(db, "Prodotti"), payload);
        toast.success("Prodotto creato");
      } else if (panelMode === "edit" && editingId) {
        await updateDoc(doc(db, "Prodotti", editingId), payload);
        toast.success("Prodotto aggiornato");
      }

      closePanel();
      await loadProdotti();
    } catch (err) {
      console.error(err);
      toast.error("Errore durante il salvataggio");
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Prodotti</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "Caricamento…" : `${filtered.length} prodotti`}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold hover:opacity-80 transition-opacity"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
        >
          <Plus size={15} />
          Aggiungi prodotto
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      <Card padding="sm">
        {/* Toolbar */}
        <div className="flex gap-2 mb-3 flex-wrap items-center">
          <div className="flex-1 min-w-48 relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per marca, modello, EAN…"
              className="w-full pl-9 pr-4 py-2 rounded-xl text-sm outline-none"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }}
            />
          </div>
          <select value={marca} onChange={(e) => setMarca(e.target.value)}
            className="px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
            <option value="">Tutte le marche</option>
            {marcheUniche.map((m) => <option key={m}>{m}</option>)}
          </select>
          <select value={stagione} onChange={(e) => setStagione(e.target.value)}
            className="px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
            <option value="">Tutte le stagioni</option>
            <option value="Estive">Estive</option>
            <option value="Invernali">Invernali</option>
            <option value="4-Stagioni">4 Stagioni</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer flex-shrink-0"
            style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
            <input type="checkbox" checked={soloDisponibili}
              onChange={(e) => setSoloDisponibili(e.target.checked)} className="rounded" />
            Solo disponibili
          </label>
          {hasFilters && (
            <button onClick={reset}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              <X size={13} />
            </button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                {["", "Marca / Modello", "Misura", "Stagione", "Stock totale", "P. Gommista", "P. Acquisto", ""].map((h, i) => (
                  <th key={i} className="pb-2.5 pr-3 text-left text-[10px] font-bold uppercase tracking-widest whitespace-nowrap"
                    style={{ color: "var(--text-muted)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="py-3 pr-3">
                        <div className="h-3.5 rounded animate-pulse"
                          style={{ background: "var(--border)", width: j === 0 ? "2.5rem" : "75%" }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                    Nessun prodotto trovato.
                  </td>
                </tr>
              ) : (
                paginated.map((p) => {
                  const ts = stockTotale(p);
                  return (
                    <tr key={p.objectID} className="border-t hover:bg-[#FFFDF0] transition-colors cursor-pointer"
                      style={{ borderColor: "var(--border)" }}>
                      {/* Immagine */}
                      <td className="py-2.5 pr-3">
                        {p.Immagine ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.Immagine} alt={p.Marca}
                            className="w-9 h-9 object-contain rounded-lg"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[9px] font-bold"
                            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                            IMG
                          </div>
                        )}
                      </td>
                      {/* Marca / Modello */}
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{p.Marca}</div>
                        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>{p.Modello}</div>
                      </td>
                      {/* Misura */}
                      <td className="py-2.5 pr-3 text-sm font-medium whitespace-nowrap"
                        style={{ color: "var(--text-primary)" }}>
                        {formatMisura(p)}
                      </td>
                      {/* Stagione */}
                      <td className="py-2.5 pr-3">
                        {p.Stagione
                          ? <Badge variant={stagioneVariant[p.Stagione] ?? "neutral"}>{p.Stagione}</Badge>
                          : <span style={{ color: "var(--text-muted)" }}>—</span>}
                      </td>
                      {/* Stock */}
                      <td className="py-2.5 pr-3 text-sm font-semibold"
                        style={{ color: ts === 0 ? "#EF4444" : "var(--text-primary)" }}>
                        {ts}
                      </td>
                      {/* P. Gommista */}
                      <td className="py-2.5 pr-3 text-sm font-semibold"
                        style={{ color: "var(--text-primary)" }}>
                        {formatEuro(p.Prezzo_Gommista)}
                      </td>
                      {/* P. Acquisto */}
                      <td className="py-2.5 pr-3 text-sm"
                        style={{ color: "var(--text-secondary)" }}>
                        {p.Prezzo_Acquisto != null ? formatEuro(p.Prezzo_Acquisto) : "—"}
                      </td>
                      {/* Azioni */}
                      <td className="py-2.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); openView(p); }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            style={{ border: "1px solid var(--border)" }}
                            title="Visualizza"
                          >
                            <Eye size={13} style={{ color: "var(--text-secondary)" }} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            style={{ border: "1px solid var(--border)" }}
                            title="Modifica"
                          >
                            <Pencil size={13} style={{ color: "var(--text-secondary)" }} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(p.objectID, p.Marca, p.Modello); }}
                            className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                            style={{ border: "1px solid var(--border)" }}
                            title="Elimina"
                          >
                            <Trash2 size={13} style={{ color: "#DC2626" }} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {nbPages > 1 && (
          <div className="flex items-center justify-between mt-3 pt-3"
            style={{ borderTop: "1px solid var(--border)" }}>
            <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} di {filtered.length}
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1.5 rounded-lg disabled:opacity-30"
                style={{ border: "1px solid var(--border)", background: "var(--bg-primary)" }}>
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: Math.min(nbPages, 7) }).map((_, i) => {
                const half = 3;
                let start = Math.max(0, page - half);
                const end = Math.min(nbPages - 1, start + 6);
                start = Math.max(0, end - 6);
                const idx = start + i;
                if (idx >= nbPages) return null;
                const active = idx === page;
                return (
                  <button key={idx} onClick={() => setPage(idx)}
                    className="w-7 h-7 rounded-lg text-xs font-semibold"
                    style={{
                      background: active ? "var(--brand)" : "var(--bg-primary)",
                      border: `1px solid ${active ? "var(--brand)" : "var(--border)"}`,
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-montserrat)",
                    }}>
                    {idx + 1}
                  </button>
                );
              })}
              <button onClick={() => setPage((p) => Math.min(nbPages - 1, p + 1))} disabled={page >= nbPages - 1}
                className="p-1.5 rounded-lg disabled:opacity-30"
                style={{ border: "1px solid var(--border)", background: "var(--bg-primary)" }}>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Side Panel */}
      {panelOpen && (
        <SidePanel
          mode={panelMode}
          form={form}
          saving={saving}
          prezziExpanded={prezziExpanded}
          onTogglePrezzi={() => setPrezziExpanded((v) => !v)}
          onChange={handleChange}
          onSave={handleSave}
          onClose={closePanel}
        />
      )}
    </div>
  );
}
