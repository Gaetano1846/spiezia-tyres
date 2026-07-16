"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  getDocs, collection, query, orderBy, limit,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  ArrowLeft, Pencil, Car, FileText, Calendar, StickyNote,
  Plus, Eye, Phone, Mail, Building2, CreditCard, AlertCircle,
  X, Check, ShoppingBag, Wrench, Bell,
} from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import DateField from "@/components/ui/DateField";
import toast from "react-hot-toast";
import type { Cliente, Preventivo, Veicolo } from "@/lib/types";
import type { OrdineListItemApi } from "@/lib/ordiniDb";
import type { AppuntamentoApi } from "@/lib/appuntamentiDb";
import type { FoglioApi } from "@/lib/fogliDb";
import type { PromemoriaApi } from "@/lib/promemoriaDb";

const appStatoVariant: Record<string, "success" | "brand" | "neutral" | "error"> = {
  Completato:  "success",
  "In corso":  "brand",
  Programmato: "neutral",
  Annullato:   "error",
};

type Tab = "Veicoli" | "Preventivi" | "Appuntamenti" | "Ordini" | "FogliDiLavoro" | "Promemoria" | "Note";
const TABS: Tab[] = ["Veicoli", "Preventivi", "Appuntamenti", "Ordini", "FogliDiLavoro", "Promemoria", "Note"];

type PromemoriaForm = {
  nome: string;
  descrizione: string;
  scadenza: string;
};
const emptyPromemoriaForm = (): PromemoriaForm => ({ nome: "", descrizione: "", scadenza: "" });

// Accetta sia Timestamp Firestore (Preventivi/Ordini — fuori scope, non migrati)
// sia ISO string (Appuntamenti/Fogli — Postgres via API, Fase 7).
function fmtData(v: Timestamp | string | null | undefined): string {
  const d = !v ? null : typeof v === "string" ? new Date(v) : v.toDate?.() ?? null;
  if (!d) return "—";
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

// Ordini: da Postgres (core.ordini) — Data arriva già come ISO string, non
// un Timestamp Firestore come le altre tab di questa pagina.
function fmtDataIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtOra(v: Timestamp | string | null | undefined): string {
  const d = !v ? null : typeof v === "string" ? new Date(v) : v.toDate?.() ?? null;
  if (!d) return "—";
  return d.toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function euro(n: number | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

type PrevWithClienteId = Preventivo & { _clienteId: string };

type EditForm = {
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

type VeicoloForm = {
  Marca: string;
  Modello: string;
  Targa: string;
  Anno: string;
  Km: string;
  Note: string;
};

const emptyVeicoloForm = (): VeicoloForm => ({
  Marca: "", Modello: "", Targa: "", Anno: "", Km: "", Note: "",
});

export default function ClienteDetailPage() {
  const params = useParams();
  const id     = params.id as string;

  const [cliente,      setCliente]      = useState<Cliente | null>(null);
  const [veicoli,      setVeicoli]      = useState<Veicolo[]>([]);
  const [preventivi,   setPreventivi]   = useState<PrevWithClienteId[]>([]);
  const [appuntamenti, setAppuntamenti] = useState<AppuntamentoApi[]>([]);
  const [ordini,       setOrdini]       = useState<OrdineListItemApi[]>([]);
  const [fogli,        setFogli]        = useState<FoglioApi[]>([]);
  const [promemoria,   setPromemoria]   = useState<PromemoriaApi[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [activeTab,    setActiveTab]    = useState<Tab>("Veicoli");
  const [nota,         setNota]         = useState("");
  const [savingNota,   setSavingNota]   = useState(false);

  // Promemoria
  const [showPromemoriaModal, setShowPromemoriaModal] = useState(false);
  const [proForm,  setProForm]  = useState<PromemoriaForm>(emptyPromemoriaForm());
  const [savingPro, setSavingPro] = useState(false);

  // Modifica cliente
  const [editMode,   setEditMode]   = useState(false);
  const [editForm,   setEditForm]   = useState<EditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Veicolo (crea / modifica)
  const [showVeicoloModal, setShowVeicoloModal] = useState(false);
  const [editVeicoloId, setEditVeicoloId] = useState<string | null>(null);
  const [veicoloForm, setVeicoloForm] = useState<VeicoloForm>(emptyVeicoloForm());
  const [savingVeicolo, setSavingVeicolo] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        // Cliente: ora su Postgres (Fase 3 migrazione). Ordini: ora su
        // Postgres (Fase 1 migrazione Ordini, core.ordini già allineato dal
        // bridge). Appuntamenti, FogliDiLavoro e Promemoria: Postgres via API
        // con filtro clienteId (Fase 7 per Appuntamenti/Fogli; Promemoria
        // chiuso dopo — b2b.promemoria esisteva già in migration 005 ma non
        // era mai stato agganciato a nessuna route, la pagina parlava ancora
        // a Firestore users/promemoria_crm/Promemoria).
        const clienteRes = await fetch(`/api/clienti/${id}`);
        if (!clienteRes.ok) {
          toast.error("Cliente non trovato");
          return;
        }
        const { cliente: c } = (await clienteRes.json()) as { cliente: Cliente };
        setCliente(c);
        setNota(c.Note ?? "");

        const [veicoliRes, preventiviSnap, appRes, ordiniRes, fogliRes, proRes] = await Promise.all([
          fetch(`/api/clienti/${id}/veicoli`),
          getDocs(query(collection(db, "Clienti", id, "Preventivo"), orderBy("DataCreazione", "desc"), limit(50))),
          fetch(`/api/appuntamenti?clienteId=${id}&limit=50`),
          fetch(`/api/admin/ordini?clienteId=${id}`),
          fetch(`/api/fogli-di-lavoro?clienteId=${id}&limit=50`),
          fetch(`/api/promemoria?clienteId=${id}&limit=50`),
        ]);

        if (!proRes.ok) throw new Error("Errore nel caricamento promemoria");
        const { promemoria: proList } = (await proRes.json()) as { promemoria: PromemoriaApi[] };
        setPromemoria(proList); // già ordinati asc per data (nulls last) lato server

        const { veicoli: veicoliList } = (await veicoliRes.json()) as { veicoli: Veicolo[] };
        setVeicoli(veicoliList);
        setPreventivi(preventiviSnap.docs.map((d) => ({
          id: d.id,
          _clienteId: id,
          ...d.data(),
        } as PrevWithClienteId)));
        if (!appRes.ok) throw new Error("Errore nel caricamento appuntamenti");
        const { appuntamenti: appList } = (await appRes.json()) as { appuntamenti: AppuntamentoApi[] };
        setAppuntamenti(appList); // già ordinati desc per data_ora lato server

        // core.ordini è già ordinato per data desc lato route.
        const ordiniData = (await ordiniRes.json().catch(() => ({}))) as { ordini?: OrdineListItemApi[] };
        setOrdini(ordiniData.ordini ?? []);

        if (!fogliRes.ok) throw new Error("Errore nel caricamento fogli di lavoro");
        const { fogli: fogliList } = (await fogliRes.json()) as { fogli: FoglioApi[] };
        setFogli(fogliList); // già ordinati desc per data_ora/data_creazione lato server
      } catch (e) {
        toast.error("Errore nel caricamento cliente");
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [id]);

  function openEdit() {
    if (!cliente) return;
    setEditForm({
      Nome: cliente.Nome ?? "",
      Email: cliente.Email ?? "",
      Telefono: cliente.Telefono ?? "",
      Via: cliente.Via ?? "",
      Citta: cliente.Citta ?? "",
      CAP: cliente.CAP ?? "",
      Codice_Fiscale: cliente.Codice_Fiscale ?? "",
      Partita_Iva: cliente.Partita_Iva ?? "",
      PEC: cliente.PEC ?? "",
      Azienda: cliente.Azienda ?? false,
      Ragione_Sociale: cliente.Ragione_Sociale ?? "",
    });
    setEditMode(true);
  }

  async function handleSaveEdit() {
    if (!editForm) return;
    setSavingEdit(true);
    try {
      const updates: Record<string, unknown> = {
        Nome: editForm.Nome,
        Email: editForm.Email,
        Telefono: editForm.Telefono,
        Via: editForm.Via,
        Citta: editForm.Citta,
        CAP: editForm.CAP,
        Codice_Fiscale: editForm.Codice_Fiscale,
        Partita_Iva: editForm.Partita_Iva,
        PEC: editForm.PEC,
        Azienda: editForm.Azienda,
        Ragione_Sociale: editForm.Ragione_Sociale,
      };
      const res = await fetch(`/api/clienti/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("save failed");
      setCliente((prev) => prev ? {
        ...prev,
        Nome: editForm.Nome,
        Email: editForm.Email,
        Telefono: editForm.Telefono,
        Via: editForm.Via,
        Citta: editForm.Citta,
        CAP: editForm.CAP,
        Codice_Fiscale: editForm.Codice_Fiscale,
        Partita_Iva: editForm.Partita_Iva,
        PEC: editForm.PEC,
        Azienda: editForm.Azienda,
        Ragione_Sociale: editForm.Ragione_Sociale,
      } : prev);
      toast.success("Cliente aggiornato");
      setEditMode(false);
    } catch {
      toast.error("Errore nel salvataggio");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleSaveNota() {
    if (savingNota) return;
    setSavingNota(true);
    try {
      const res = await fetch(`/api/clienti/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Note: nota }),
      });
      if (!res.ok) throw new Error("save failed");
      toast.success("Nota salvata");
    } catch {
      toast.error("Errore salvataggio nota");
    } finally {
      setSavingNota(false);
    }
  }

  function openVeicoloModal(veicolo?: Veicolo) {
    if (veicolo) {
      setEditVeicoloId(veicolo.id);
      setVeicoloForm({
        Marca: veicolo.Marca ?? "",
        Modello: veicolo.Modello ?? "",
        Targa: veicolo.Targa ?? "",
        Anno: veicolo.Anno != null ? String(veicolo.Anno) : "",
        Km: veicolo.Km != null ? String(veicolo.Km) : "",
        Note: veicolo.Note ?? "",
      });
    } else {
      setEditVeicoloId(null);
      setVeicoloForm(emptyVeicoloForm());
    }
    setShowVeicoloModal(true);
  }

  async function handleSaveVeicolo() {
    if (!veicoloForm.Marca || !veicoloForm.Modello) {
      toast.error("Inserisci marca e modello");
      return;
    }
    setSavingVeicolo(true);
    try {
      const payload: Record<string, unknown> = {
        Marca: veicoloForm.Marca,
        Modello: veicoloForm.Modello,
        Targa: veicoloForm.Targa,
      };
      if (veicoloForm.Anno) payload.Anno = Number(veicoloForm.Anno);
      if (veicoloForm.Km) payload.Km = Number(veicoloForm.Km);
      if (veicoloForm.Note) payload.Note = veicoloForm.Note;

      if (editVeicoloId) {
        const res = await fetch(`/api/veicoli/${editVeicoloId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("update failed");
        setVeicoli((prev) => prev.map((v) => v.id === editVeicoloId ? {
          ...v,
          Marca: veicoloForm.Marca,
          Modello: veicoloForm.Modello,
          Targa: veicoloForm.Targa,
          Anno: veicoloForm.Anno ? Number(veicoloForm.Anno) : undefined,
          Km: veicoloForm.Km ? Number(veicoloForm.Km) : undefined,
          Note: veicoloForm.Note || undefined,
        } : v));
        toast.success("Veicolo aggiornato");
      } else {
        const res = await fetch(`/api/clienti/${id}/veicoli`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("create failed");
        const { veicolo } = (await res.json()) as { veicolo: Veicolo };
        setVeicoli((prev) => [...prev, veicolo]);
        toast.success("Veicolo aggiunto");
      }

      setShowVeicoloModal(false);
      setEditVeicoloId(null);
      setVeicoloForm(emptyVeicoloForm());
    } catch {
      toast.error(editVeicoloId ? "Errore nell'aggiornamento" : "Errore nell'aggiunta del veicolo");
    } finally {
      setSavingVeicolo(false);
    }
  }

  async function handleAddPromemoria() {
    if (!proForm.nome.trim()) { toast.error("Inserisci il nome del promemoria"); return; }
    setSavingPro(true);
    try {
      const res = await fetch("/api/promemoria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteId: id,
          nome: proForm.nome.trim(),
          descrizione: proForm.descrizione.trim() || null,
          dataScadenza: proForm.scadenza ? new Date(proForm.scadenza).toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error("create failed");
      const { promemoria: nuovo } = (await res.json()) as { promemoria: PromemoriaApi };
      setPromemoria((prev) => [...prev, nuovo]);
      setProForm(emptyPromemoriaForm());
      setShowPromemoriaModal(false);
      toast.success("Promemoria aggiunto");
    } catch {
      toast.error("Errore nell'aggiunta del promemoria");
    } finally {
      setSavingPro(false);
    }
  }

  async function handleToggleCompletata(p: PromemoriaApi) {
    try {
      const res = await fetch(`/api/promemoria/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completata: !p.Completata }),
      });
      if (!res.ok) throw new Error("update failed");
      setPromemoria((prev) => prev.map((x) => x.id === p.id ? { ...x, Completata: !p.Completata } : x));
    } catch {
      toast.error("Errore nell'aggiornamento");
    }
  }

  async function handleDeletePromemoria(p: PromemoriaApi) {
    if (!confirm(`Eliminare il promemoria "${p.Nome}"?`)) return;
    try {
      const res = await fetch(`/api/promemoria/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setPromemoria((prev) => prev.filter((x) => x.id !== p.id));
      toast.success("Promemoria eliminato");
    } catch {
      toast.error("Errore nell'eliminazione");
    }
  }

  async function handleDeleteVeicolo(veicoloId: string) {
    if (!confirm("Eliminare questo veicolo? L'operazione non può essere annullata.")) return;
    try {
      const res = await fetch(`/api/veicoli/${veicoloId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setVeicoli((prev) => prev.filter((v) => v.id !== veicoloId));
      toast.success("Veicolo eliminato");
    } catch {
      toast.error("Errore nell'eliminazione del veicolo");
    }
  }

  if (loading) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="h-6 w-40 rounded-xl" style={{ background: "var(--bg-secondary)" }} />
        <div className="h-32 rounded-2xl" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }} />
        <div className="h-64 rounded-2xl" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }} />
      </div>
    );
  }

  if (!cliente) {
    return (
      <div className="text-center py-20" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
        <p className="text-sm">Cliente non trovato.</p>
        <Link href="/clienti" className="text-sm font-semibold mt-3 inline-block" style={{ color: "var(--brand)" }}>
          ← Torna ai clienti
        </Link>
      </div>
    );
  }

  const nome = (cliente.Azienda && cliente.Ragione_Sociale)
    ? cliente.Ragione_Sociale
    : cliente.Nome?.trim() || cliente.Ragione_Sociale || "—";
  const fidoUsato = cliente.Fido != null && cliente.Fido_Residuo != null
    ? cliente.Fido - cliente.Fido_Residuo
    : null;

  const tabIcons: Record<Tab, React.ElementType> = {
    Veicoli:      Car,
    Preventivi:   FileText,
    Appuntamenti: Calendar,
    Ordini:       ShoppingBag,
    FogliDiLavoro: Wrench,
    Promemoria:   Bell,
    Note:         StickyNote,
  };

  const tabLabels: Record<Tab, string> = {
    Veicoli:      "Veicoli",
    Preventivi:   "Preventivi",
    Appuntamenti: "Appuntamenti",
    Ordini:       "Ordini",
    FogliDiLavoro: "Fogli",
    Promemoria:   "Promemoria",
    Note:         "Note",
  };

  const tabCounts: Record<Tab, number | undefined> = {
    Veicoli:      veicoli.length,
    Preventivi:   preventivi.length,
    Appuntamenti: appuntamenti.length,
    Ordini:       ordini.length,
    FogliDiLavoro: fogli.length,
    Promemoria:   promemoria.filter((p) => !p.Completata).length,
    Note:         undefined,
  };

  return (
    <div className="space-y-6">
      {/* Modal nuovo veicolo */}
      {showVeicoloModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowVeicoloModal(false); }}
        >
          <div
            className="w-full max-w-md rounded-2xl p-6"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                {editVeicoloId ? "Modifica veicolo" : "Aggiungi veicolo"}
              </h3>
              <button
                onClick={() => setShowVeicoloModal(false)}
                className="p-1.5 rounded-lg hover:bg-[#F1F4F8] transition-colors"
              >
                <X size={16} style={{ color: "var(--text-muted)" }} />
              </button>
            </div>

            <div className="space-y-3">
              {(["Marca", "Modello"] as const).map((field) => (
                <div key={field}>
                  <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                    {field} {field === "Marca" || field === "Modello" ? <span style={{ color: "#EF4444" }}>*</span> : null}
                  </label>
                  <input
                    type="text"
                    value={veicoloForm[field]}
                    onChange={(e) => setVeicoloForm((f) => ({ ...f, [field]: e.target.value }))}
                    placeholder={field}
                    className="w-full px-3 py-2 rounded-xl text-sm"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                  Targa
                </label>
                <input
                  type="text"
                  value={veicoloForm.Targa}
                  onChange={(e) => setVeicoloForm((f) => ({ ...f, Targa: e.target.value.toUpperCase() }))}
                  placeholder="ES000AA"
                  className="w-full px-3 py-2 rounded-xl text-sm font-mono"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                    Anno
                  </label>
                  <input
                    type="number"
                    value={veicoloForm.Anno}
                    onChange={(e) => setVeicoloForm((f) => ({ ...f, Anno: e.target.value }))}
                    placeholder="2020"
                    min={1900}
                    max={2100}
                    className="w-full px-3 py-2 rounded-xl text-sm"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                    Km
                  </label>
                  <input
                    type="number"
                    value={veicoloForm.Km}
                    onChange={(e) => setVeicoloForm((f) => ({ ...f, Km: e.target.value }))}
                    placeholder="50000"
                    min={0}
                    className="w-full px-3 py-2 rounded-xl text-sm"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                  Note
                </label>
                <textarea
                  value={veicoloForm.Note}
                  onChange={(e) => setVeicoloForm((f) => ({ ...f, Note: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl text-sm resize-none"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => { setShowVeicoloModal(false); setEditVeicoloId(null); setVeicoloForm(emptyVeicoloForm()); }}
                className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}
              >
                Annulla
              </button>
              <button
                onClick={handleSaveVeicolo}
                disabled={savingVeicolo}
                className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                {savingVeicolo ? "Salvataggio…" : (editVeicoloId ? "Salva modifiche" : "Aggiungi")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back */}
      <Link
        href="/clienti"
        className="inline-flex items-center gap-1.5 text-sm font-medium"
        style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
      >
        <ArrowLeft size={15} /> Clienti
      </Link>

      {/* Header card */}
      <Card>
        {editMode && editForm ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                Modifica cliente
              </h2>
              <button
                onClick={() => setEditMode(false)}
                className="p-1.5 rounded-lg hover:bg-[#F1F4F8]"
              >
                <X size={16} style={{ color: "var(--text-muted)" }} />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                <input
                  type="checkbox"
                  checked={editForm.Azienda}
                  onChange={(e) => setEditForm((f) => f ? { ...f, Azienda: e.target.checked } : f)}
                  className="w-4 h-4 rounded"
                />
                È un&apos;azienda
              </label>
            </div>

            {editForm.Azienda && (
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                  Ragione Sociale
                </label>
                <input
                  type="text"
                  value={editForm.Ragione_Sociale}
                  onChange={(e) => setEditForm((f) => f ? { ...f, Ragione_Sociale: e.target.value } : f)}
                  className="w-full px-3 py-2 rounded-xl text-sm"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                ["Nome", "Nome"],
                ["Email", "Email"],
                ["Telefono", "Telefono"],
                ["Via", "Indirizzo"],
                ["Citta", "Città"],
                ["CAP", "CAP"],
                ["Codice_Fiscale", "Codice Fiscale"],
                ["Partita_Iva", "Partita IVA"],
                ["PEC", "PEC"],
              ] as [keyof EditForm, string][]).map(([field, label]) => (
                <div key={field}>
                  <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                    {label}
                  </label>
                  <input
                    type={field === "Email" ? "email" : field === "Telefono" ? "tel" : "text"}
                    value={editForm[field] as string}
                    onChange={(e) => setEditForm((f) => f ? { ...f, [field]: e.target.value } : f)}
                    className="w-full px-3 py-2 rounded-xl text-sm"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setEditMode(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}
              >
                Annulla
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={savingEdit}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                <Check size={14} />
                {savingEdit ? "Salvataggio…" : "Salva modifiche"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                  {nome}
                </h1>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                {cliente.Email && (
                  <div className="flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                    <Mail size={13} style={{ color: "var(--text-muted)" }} /> {cliente.Email}
                  </div>
                )}
                {cliente.Telefono && (
                  <div className="flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                    <Phone size={13} style={{ color: "var(--text-muted)" }} /> {cliente.Telefono}
                  </div>
                )}
                {cliente.Partita_Iva && (
                  <div className="flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                    <Building2 size={13} style={{ color: "var(--text-muted)" }} /> P.IVA {cliente.Partita_Iva}
                  </div>
                )}
                {cliente.Codice_Fiscale && (
                  <div className="flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                    <CreditCard size={13} style={{ color: "var(--text-muted)" }} /> CF {cliente.Codice_Fiscale}
                  </div>
                )}
              </div>

              {/* Fido */}
              {cliente.Fido != null && (
                <div className="mt-4 flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={13} style={{ color: cliente.Fido_Residuo && cliente.Fido_Residuo < (cliente.Fido * 0.2) ? "#EF4444" : "#249689" }} />
                    <span className="text-xs font-semibold" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
                      Fido: {euro(cliente.Fido)} · Residuo: {euro(cliente.Fido_Residuo)}
                      {fidoUsato != null && ` · Usato: ${euro(fidoUsato)}`}
                    </span>
                  </div>
                  {cliente.Fido_Residuo != null && cliente.Fido != null && cliente.Fido > 0 && (
                    <div className="flex-1 min-w-[120px] max-w-[200px] h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, ((cliente.Fido - cliente.Fido_Residuo) / cliente.Fido) * 100)}%`,
                          background: cliente.Fido_Residuo < (cliente.Fido * 0.2) ? "#EF4444" : "#249689",
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={openEdit}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl flex-shrink-0"
              style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
            >
              <Pencil size={14} /> Modifica
            </button>
          </div>
        )}
      </Card>

      {/* Tabs */}
      <Card padding="none">
        <div className="flex gap-0 overflow-x-auto" style={{ borderBottom: "1px solid var(--border)" }}>
          {TABS.map((tab) => {
            const Icon = tabIcons[tab];
            const count = tabCounts[tab];
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="flex items-center gap-2 px-5 py-3.5 text-sm font-semibold transition-colors flex-shrink-0"
                style={{
                  fontFamily: "var(--font-montserrat)",
                  color:       activeTab === tab ? "var(--text-primary)" : "var(--text-muted)",
                  borderBottom: activeTab === tab ? "2px solid var(--brand)" : "2px solid transparent",
                  marginBottom: "-1px",
                }}
              >
                <Icon size={14} />
                {tabLabels[tab]}
                {count !== undefined && (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: activeTab === tab ? "var(--brand)" : "var(--bg-secondary)", color: activeTab === tab ? "#111" : "var(--text-muted)" }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="p-5">
          {/* VEICOLI */}
          {activeTab === "Veicoli" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-medium" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                  {veicoli.length} veicoli registrati
                </p>
                <button
                  onClick={() => openVeicoloModal()}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl"
                  style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
                >
                  <Plus size={13} /> Aggiungi veicolo
                </button>
              </div>
              {veicoli.length === 0 ? (
                <div className="text-center py-10" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  <Car size={28} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Nessun veicolo registrato</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["Targa", "Marca / Modello", "Anno", "Km", ""].map((h) => (
                          <th key={h} className="text-left pb-3 px-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {veicoli.map((v) => (
                        <tr key={v.id} className="hover:bg-[#F1F4F8] transition-colors" style={{ borderBottom: "1px solid var(--border)" }}>
                          <td className="px-2 py-3 font-semibold font-mono text-xs" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>{v.Targa || "—"}</td>
                          <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>{v.Marca} {v.Modello}</td>
                          <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>{v.Anno ?? "—"}</td>
                          <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>{v.Km ? `${v.Km.toLocaleString("it-IT")} km` : "—"}</td>
                          <td className="px-2 py-3">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => openVeicoloModal(v)}
                                className="p-1.5 rounded-lg hover:bg-white transition-colors"
                                style={{ border: "1px solid var(--border)" }}
                                title="Modifica veicolo"
                              >
                                <Pencil size={12} style={{ color: "var(--text-secondary)" }} />
                              </button>
                              <button
                                onClick={() => handleDeleteVeicolo(v.id)}
                                className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                                style={{ border: "1px solid var(--border)" }}
                                title="Elimina veicolo"
                              >
                                <X size={12} style={{ color: "#DC2626" }} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* PREVENTIVI */}
          {activeTab === "Preventivi" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-medium" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                  {preventivi.length} preventivi
                </p>
                <Link
                  href="/preventivi/nuova"
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl"
                  style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
                >
                  <Plus size={13} /> Nuovo preventivo
                </Link>
              </div>
              {preventivi.length === 0 ? (
                <div className="text-center py-10" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  <FileText size={28} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Nessun preventivo</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["Numero", "Data", "Pezzi", "Stato", ""].map((h) => (
                          <th key={h} className="text-left pb-3 px-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preventivi.map((p) => {
                        const numero = p.ID != null ? `#${p.ID}` : `#${p.id.slice(0, 6).toUpperCase()}`;
                        const statoLabel = p.Accettato ? "Accettato" : "In attesa";
                        const pezzi = p.Pneumatici_Nuovi?.reduce((s, pn) => s + (pn.Quantita ?? 0), 0) ?? 0;
                        return (
                          <tr key={p.id} className="hover:bg-[#F1F4F8] transition-colors" style={{ borderBottom: "1px solid var(--border)" }}>
                            <td className="px-2 py-3 font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                              {numero}
                            </td>
                            <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                              {p.Data ?? fmtData(p.Data_Creazione as Timestamp)}
                            </td>
                            <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                              {pezzi > 0 ? `${pezzi} pz` : "—"}
                            </td>
                            <td className="px-2 py-3">
                              <Badge variant={statoLabel === "Accettato" ? "success" : "neutral"}>{statoLabel}</Badge>
                            </td>
                            <td className="px-2 py-3">
                              <Link
                                href={`/preventivi/${p._clienteId}/${p.id}`}
                                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
                                style={{ border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}
                              >
                                <Eye size={13} /> Apri
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* APPUNTAMENTI */}
          {activeTab === "Appuntamenti" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-medium" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                  {appuntamenti.length} appuntamenti
                </p>
                <Link
                  href="/appuntamenti/nuova"
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl"
                  style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
                >
                  <Plus size={13} /> Nuovo
                </Link>
              </div>
              {appuntamenti.length === 0 ? (
                <div className="text-center py-10" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  <Calendar size={28} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Nessun appuntamento</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["Data e ora", "Servizi", "Stato"].map((h) => (
                          <th key={h} className="text-left pb-3 px-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {appuntamenti.map((a) => (
                        <tr key={a.id} className="hover:bg-[#F1F4F8] transition-colors" style={{ borderBottom: "1px solid var(--border)" }}>
                          <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                            {fmtOra(a.DataOra)}
                          </td>
                          <td className="px-2 py-3 max-w-[200px] truncate" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                            {a.Servizi?.map((s) => s.Titolo).join(", ") ?? "—"}
                          </td>
                          <td className="px-2 py-3">
                            <Badge variant={appStatoVariant[a.Stato] ?? "neutral"}>{a.Stato}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ORDINI */}
          {activeTab === "Ordini" && (
            <div>
              <p className="text-sm font-medium mb-4" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                {ordini.length} ordini
              </p>
              {ordini.length === 0 ? (
                <div className="text-center py-10" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  <ShoppingBag size={28} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Nessun ordine registrato</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["Numero", "Data", "Totale", "Stato", ""].map((h) => (
                          <th key={h} className="text-left pb-3 px-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ordini.map((o) => {
                        const ordineStato = (o.Stato ?? "—") as string;
                        return (
                          <tr key={o.id} className="hover:bg-[#F1F4F8] transition-colors" style={{ borderBottom: "1px solid var(--border)" }}>
                            <td className="px-2 py-3 font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                              {o.Numero ?? `#${o.id.slice(0, 6).toUpperCase()}`}
                            </td>
                            <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                              {fmtDataIso(o.Data)}
                            </td>
                            <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                              {euro(o.Totale)}
                            </td>
                            <td className="px-2 py-3">
                              <Badge variant="neutral">{ordineStato}</Badge>
                            </td>
                            <td className="px-2 py-3">
                              <Link
                                href={`/ordini/${o.id}`}
                                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
                                style={{ border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}
                              >
                                <Eye size={13} /> Apri
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* FOGLI DI LAVORO */}
          {activeTab === "FogliDiLavoro" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-medium" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                  {fogli.length} fogli di lavoro
                </p>
                <Link
                  href="/fogli-di-lavoro/nuovo"
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl"
                  style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
                >
                  <Plus size={13} /> Nuovo foglio
                </Link>
              </div>
              {fogli.length === 0 ? (
                <div className="text-center py-10" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  <Wrench size={28} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Nessun foglio di lavoro</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["Numero", "Data", "Stato", ""].map((h) => (
                          <th key={h} className="text-left pb-3 px-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {fogli.map((f) => (
                        <tr key={f.id} className="hover:bg-[#F1F4F8] transition-colors" style={{ borderBottom: "1px solid var(--border)" }}>
                          <td className="px-2 py-3 font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                            {f.Numero != null ? `#${f.Numero}` : `#${f.id.slice(0, 6).toUpperCase()}`}
                          </td>
                          <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                            {fmtData(f.DataOra ?? f.DataCreazione)}
                          </td>
                          <td className="px-2 py-3">
                            <Badge variant={f.Stato === "Completato" ? "success" : f.Stato === "In lavorazione" ? "brand" : "neutral"}>
                              {f.Stato}
                            </Badge>
                          </td>
                          <td className="px-2 py-3">
                            <Link
                              href={`/fogli-di-lavoro/${f.id}`}
                              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
                              style={{ border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}
                            >
                              <Eye size={13} /> Apri
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* PROMEMORIA */}
          {activeTab === "Promemoria" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-medium" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                  {promemoria.filter((p) => !p.Completata).length} attivi · {promemoria.filter((p) => p.Completata).length} completati
                </p>
                <button
                  onClick={() => { setProForm(emptyPromemoriaForm()); setShowPromemoriaModal(true); }}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl"
                  style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
                >
                  <Plus size={13} /> Aggiungi
                </button>
              </div>

              {promemoria.length === 0 ? (
                <div className="text-center py-10" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  <Bell size={28} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Nessun promemoria</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {promemoria.map((p) => {
                    const scaduto = !!p.DataScadenza && !p.Completata &&
                      new Date(p.DataScadenza) < new Date();
                    return (
                      <div key={p.id}
                        className="flex items-start gap-3 px-4 py-3 rounded-xl"
                        style={{
                          background: p.Completata ? "var(--bg-primary)" : scaduto ? "#FEF2F2" : "var(--bg-primary)",
                          border: `1px solid ${p.Completata ? "var(--border)" : scaduto ? "#FCA5A5" : "var(--border)"}`,
                          opacity: p.Completata ? 0.6 : 1,
                        }}
                      >
                        <button
                          onClick={() => handleToggleCompletata(p)}
                          className="mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors"
                          style={{
                            borderColor: p.Completata ? "#249689" : "var(--border)",
                            background:  p.Completata ? "#249689" : "transparent",
                          }}
                        >
                          {p.Completata && <Check size={11} style={{ color: "#fff" }} />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold" style={{
                            color: "var(--text-primary)",
                            fontFamily: "var(--font-montserrat)",
                            textDecoration: p.Completata ? "line-through" : "none",
                          }}>
                            {p.Nome}
                          </p>
                          {p.Descrizione && (
                            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                              {p.Descrizione}
                            </p>
                          )}
                          {p.DataScadenza && (
                            <p className="text-xs mt-1 font-semibold" style={{
                              color: scaduto ? "#EF4444" : "var(--text-muted)",
                              fontFamily: "var(--font-montserrat)",
                            }}>
                              {scaduto ? "Scaduto · " : "Scade · "}{fmtData(p.DataScadenza)}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeletePromemoria(p)}
                          className="p-1.5 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0"
                        >
                          <X size={12} style={{ color: "#DC2626" }} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add promemoria modal */}
              {showPromemoriaModal && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center p-4"
                  style={{ background: "rgba(0,0,0,0.5)" }}
                  onClick={(e) => { if (e.target === e.currentTarget) setShowPromemoriaModal(false); }}
                >
                  <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="text-base font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                        Nuovo promemoria
                      </h3>
                      <button onClick={() => setShowPromemoriaModal(false)} className="p-1.5 rounded-lg hover:bg-[#F1F4F8]">
                        <X size={16} style={{ color: "var(--text-muted)" }} />
                      </button>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                          Nome *
                        </label>
                        <input
                          type="text"
                          value={proForm.nome}
                          onChange={(e) => setProForm((f) => ({ ...f, nome: e.target.value }))}
                          placeholder="es. Richiamare per preventivo"
                          className="w-full px-3 py-2 rounded-xl text-sm"
                          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                          Descrizione
                        </label>
                        <textarea
                          value={proForm.descrizione}
                          onChange={(e) => setProForm((f) => ({ ...f, descrizione: e.target.value }))}
                          rows={2}
                          className="w-full px-3 py-2 rounded-xl text-sm resize-none"
                          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                          Scadenza
                        </label>
                        <DateField
                          value={proForm.scadenza}
                          onChange={(iso) => setProForm((f) => ({ ...f, scadenza: iso }))}
                          fullWidth
                          placeholder="Nessuna scadenza"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-3 mt-5">
                      <button onClick={() => setShowPromemoriaModal(false)}
                        className="px-4 py-2 rounded-xl text-sm font-semibold"
                        style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
                        Annulla
                      </button>
                      <button onClick={handleAddPromemoria} disabled={savingPro}
                        className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
                        style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}>
                        {savingPro ? "Salvataggio…" : "Aggiungi"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* NOTE */}
          {activeTab === "Note" && (
            <div className="space-y-4">
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={5}
                placeholder="Aggiungi note sul cliente…"
                className="w-full rounded-xl p-3 text-sm resize-none"
                style={{
                  background:  "var(--bg-primary)",
                  border:      "1px solid var(--border)",
                  fontFamily:  "var(--font-montserrat)",
                  color:       "var(--text-primary)",
                  outline:     "none",
                }}
              />
              <button
                onClick={handleSaveNota}
                disabled={savingNota}
                className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-40"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                <Check size={14} />
                {savingNota ? "Salvataggio…" : "Salva nota"}
              </button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
