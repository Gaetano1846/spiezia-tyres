"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/layout/AuthProvider";
import { nextCounter } from "@/lib/counters";
import { algoliaClient, INDEX_NAME, formatMisura } from "@/lib/algolia";
import type { ProdottoHit } from "@/lib/algolia";
import type { ArticoloPreventivo } from "@/lib/preventiviDb";
import {
  ArrowLeft, Plus, X, Search, Check, Loader2, Car, User, FileText,
} from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type ClienteOption = { id: string; nome: string; telefono?: string; tipo?: string };
type VeicoloOption = { id: string; Marca?: string; Modello?: string; Targa?: string };

type RigaPneumatico = {
  id: string; // local key
  Marca: string;
  Modello: string;
  Misura: string;
  Quantita: number;
  PrezzoUnitario: string; // string per editing, poi parseFloat al salvataggio
};

type AlgoliaRaw = {
  hits: unknown[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function euro(n: number): string {
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function genId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function rigaVuota(): RigaPneumatico {
  return { id: genId(), Marca: "", Modello: "", Misura: "", Quantita: 1, PrezzoUnitario: "" };
}

// ─── Algolia Search Modal ──────────────────────────────────────────────────────

function AlgoliaSearchModal({
  onSelect,
  onClose,
}: {
  onSelect: (hit: ProdottoHit) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProdottoHit[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const raw = (await algoliaClient.searchSingleIndex({
          indexName: INDEX_NAME,
          searchParams: { query: q, hitsPerPage: 20 },
        })) as unknown as AlgoliaRaw;
        setHits((raw.hits ?? []) as ProdottoHit[]);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl w-full max-w-lg mx-4 overflow-hidden"
        style={{
          background: "#fff",
          border: "1px solid var(--border)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 p-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <Search size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cerca pneumatico (marca, misura, modello…)"
            className="flex-1 text-sm outline-none bg-transparent"
            style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
          />
          <button onClick={onClose} style={{ color: "var(--text-muted)" }}>
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <div className="flex justify-center py-8">
              <Loader2
                size={20}
                className="animate-spin"
                style={{ color: "var(--text-muted)" }}
              />
            </div>
          )}
          {!loading && hits.length === 0 && q.trim() && (
            <p
              className="text-sm text-center py-8"
              style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
            >
              Nessun risultato per &ldquo;{q}&rdquo;
            </p>
          )}
          {!loading && !q.trim() && (
            <p
              className="text-sm text-center py-8"
              style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
            >
              Inizia a digitare per cercare…
            </p>
          )}
          {hits.map((hit) => (
            <button
              key={hit.objectID}
              onClick={() => onSelect(hit)}
              className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-[#F8F9FB] transition-colors"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-semibold truncate"
                  style={{
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-montserrat)",
                  }}
                >
                  {hit.Marca} {hit.Modello}
                </p>
                <p
                  className="text-xs mt-0.5"
                  style={{
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-montserrat)",
                  }}
                >
                  {formatMisura(hit)} · {hit.Stagione}
                </p>
              </div>
              <span
                className="text-sm font-bold shrink-0"
                style={{ color: "var(--brand)", fontFamily: "var(--font-poppins)" }}
              >
                {euro(hit.Prezzo_Gommista || hit.Prezzo || 0)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NuovoPreventivoPage() {
  const router = useRouter();
  const { user } = useAuth();

  // ── Step 1: Cliente + Veicolo ────────────────────────────────────────────────

  const [clienteSearch, setClienteSearch] = useState("");
  const [clienteFocus, setClienteFocus] = useState(false);
  const [clientiSuggeriti, setClientiSuggeriti] = useState<ClienteOption[]>([]);
  const [selectedCliente, setSelectedCliente] = useState<ClienteOption | null>(null);

  const [veicoli, setVeicoli] = useState<VeicoloOption[]>([]);
  const [loadingVeicoli, setLoadingVeicoli] = useState(false);
  const [selectedVeicolo, setSelectedVeicolo] = useState<VeicoloOption | null>(null);

  // ── Step 2: Pneumatici ──────────────────────────────────────────────────────

  const [righe, setRighe] = useState<RigaPneumatico[]>([rigaVuota()]);
  const [algoliaModalFor, setAlgoliaModalFor] = useState<string | null>(null);

  // ── Step 3: Note ────────────────────────────────────────────────────────────

  const [note, setNote] = useState("");

  // ── Saving ──────────────────────────────────────────────────────────────────

  const [saving, setSaving] = useState(false);

  // ── Ricerca clienti server-side (debounced) ─────────────────────────────────

  useEffect(() => {
    if (clienteSearch.trim().length < 1) {
      setClientiSuggeriti([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/clienti?q=${encodeURIComponent(clienteSearch.trim())}&limit=40`)
        .then((r) => r.json())
        .then(({ clienti }) => {
          setClientiSuggeriti((clienti ?? []).map((c: Record<string, unknown>) => ({
            id: c.id as string,
            nome: (c.Azienda && c.Ragione_Sociale) ? (c.Ragione_Sociale as string) : ((c.Nome as string)?.trim() || (c.Ragione_Sociale as string) || "—"),
            telefono: c.Telefono as string | undefined,
            tipo: c.Tipo as string | undefined,
          })));
        })
        .catch(() => setClientiSuggeriti([]));
    }, 250);
    return () => clearTimeout(t);
  }, [clienteSearch]);

  // ── Load veicoli when cliente selected ──────────────────────────────────────

  useEffect(() => {
    if (!selectedCliente) {
      setVeicoli([]);
      setSelectedVeicolo(null);
      return;
    }
    const fetchVeicoli = async () => {
      setLoadingVeicoli(true);
      try {
        const res = await fetch(`/api/clienti/${selectedCliente.id}/veicoli`);
        const { veicoli: list } = await res.json();
        setVeicoli(list ?? []);
      } catch {
        setVeicoli([]);
      } finally {
        setLoadingVeicoli(false);
      }
    };
    fetchVeicoli();
    setSelectedVeicolo(null);
  }, [selectedCliente]);

  function handleSelectCliente(c: ClienteOption) {
    setSelectedCliente(c);
    setClienteSearch(c.nome);
    setClienteFocus(false);
  }

  function handleClearCliente() {
    setSelectedCliente(null);
    setClienteSearch("");
    setVeicoli([]);
    setSelectedVeicolo(null);
  }

  // ── Righe pneumatici ────────────────────────────────────────────────────────

  function updateRiga(
    id: string,
    field: keyof Omit<RigaPneumatico, "id">,
    value: string | number
  ) {
    setRighe((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  }

  function removeRiga(id: string) {
    setRighe((prev) => prev.filter((r) => r.id !== id));
  }

  function addRiga() {
    setRighe((prev) => [...prev, rigaVuota()]);
  }

  function handleAlgoliaSelect(hit: ProdottoHit) {
    if (!algoliaModalFor) return;
    setRighe((prev) =>
      prev.map((r) =>
        r.id === algoliaModalFor
          ? {
              ...r,
              Marca: hit.Marca,
              Modello: hit.Modello,
              Misura: formatMisura(hit),
              PrezzoUnitario: String(hit.Prezzo_Gommista || hit.Prezzo || ""),
            }
          : r
      )
    );
    setAlgoliaModalFor(null);
  }

  // ── Totale ──────────────────────────────────────────────────────────────────

  const subtotale = righe.reduce((acc, r) => {
    const prezzo = parseFloat(r.PrezzoUnitario.replace(",", ".")) || 0;
    return acc + prezzo * (r.Quantita || 0);
  }, 0);

  // ── Salvataggio ─────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!selectedCliente) {
      toast.error("Seleziona un cliente");
      return;
    }
    if (righe.length === 0) {
      toast.error("Aggiungi almeno un pneumatico");
      return;
    }

    setSaving(true);
    try {
      // Sede obbligatoria per numerazione preventivi
      const sedeDocRef = user?.Sede;
      let sedeId: string | null = null;
      if (sedeDocRef && typeof sedeDocRef === "object" && "id" in sedeDocRef) {
        sedeId = (sedeDocRef as { id: string }).id;
      } else if (user?.SedeNome) {
        sedeId = user.SedeNome;
      }
      if (!sedeId) {
        toast.error("Sede non configurata per questo account. Contatta l'amministratore.");
        setSaving(false);
        return;
      }

      // Numero progressivo per sede — l'allocatore resta Firestore finché il
      // bridge è vivo (vedi lib/counters.ts, stesso pattern di Fogli).
      const numero = await nextCounter("Preventivo", sedeId);

      const articoli: ArticoloPreventivo[] = righe.map((r) => ({
        Marca: r.Marca || undefined,
        Modello: r.Modello || undefined,
        Misura: r.Misura || undefined,
        Quantita: r.Quantita,
        PrezzoUnitario: parseFloat(r.PrezzoUnitario.replace(",", ".")) || 0,
      }));

      const res = await fetch("/api/preventivi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteId: selectedCliente.id,
          sedeId,
          operatoreId: user!.uid,
          veicoloId: selectedVeicolo?.id,
          numero,
          data: formatDate(new Date()),
          articoli,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { preventivo } = await res.json();

      toast.success(`Preventivo #${numero} creato`);
      router.push(`/preventivi/${selectedCliente.id}/${preventivo.id}`);
    } catch (e) {
      console.error(e);
      toast.error("Errore nella creazione del preventivo");
    } finally {
      setSaving(false);
    }
  }

  // ── Shared input style ───────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    fontFamily: "var(--font-montserrat)",
    color: "var(--text-primary)",
    outline: "none",
    borderRadius: 12,
    fontSize: 14,
    padding: "8px 12px",
    width: "100%",
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* ── Back link ── */}
      <Link
        href="/preventivi"
        className="inline-flex items-center gap-1.5 text-sm font-medium"
        style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
      >
        <ArrowLeft size={15} /> Preventivi
      </Link>

      {/* ── Title ── */}
      <div>
        <h1
          className="text-2xl font-bold"
          style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}
        >
          Nuovo preventivo
        </h1>
        <p
          className="text-sm mt-1"
          style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
        >
          Compila i campi e salva per creare il preventivo
        </p>
      </div>

      {/* ── Sezione 1: Cliente e Veicolo ── */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <User size={16} style={{ color: "var(--text-muted)" }} />
          <h2
            className="font-bold text-base"
            style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}
          >
            Cliente e veicolo
          </h2>
        </div>

        <div className="space-y-4">
          {/* Cliente searchable dropdown */}
          <div>
            <label
              className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
              style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
            >
              Cliente *
            </label>
            <div className="relative">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: "var(--text-muted)" }}
                />
                <input
                  type="text"
                  value={clienteSearch}
                  onChange={(e) => {
                    setClienteSearch(e.target.value);
                    if (
                      selectedCliente &&
                      e.target.value !== selectedCliente.nome
                    ) {
                      setSelectedCliente(null);
                    }
                  }}
                  onFocus={() => setClienteFocus(true)}
                  onBlur={() => setTimeout(() => setClienteFocus(false), 180)}
                  placeholder="Cerca per nome, telefono…"
                  style={{
                    ...inputStyle,
                    paddingLeft: 36,
                    paddingRight: selectedCliente ? 36 : 12,
                  }}
                />
                {selectedCliente && (
                  <button
                    type="button"
                    onClick={handleClearCliente}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Dropdown list */}
              {clienteFocus && !selectedCliente && clientiSuggeriti.length > 0 && (
                <div
                  className="absolute z-30 w-full mt-1 rounded-xl overflow-hidden"
                  style={{
                    background: "#fff",
                    border: "1px solid var(--border)",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
                    maxHeight: 240,
                    overflowY: "auto",
                  }}
                >
                  {clientiSuggeriti.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={() => handleSelectCliente(c)}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[#F8F9FB] transition-colors"
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <div>
                        <p
                          className="text-sm font-semibold"
                          style={{
                            color: "var(--text-primary)",
                            fontFamily: "var(--font-montserrat)",
                          }}
                        >
                          {c.nome}
                        </p>
                        {c.telefono && (
                          <p
                            className="text-xs"
                            style={{
                              color: "var(--text-muted)",
                              fontFamily: "var(--font-montserrat)",
                            }}
                          >
                            {c.telefono}
                          </p>
                        )}
                      </div>
                      {c.tipo && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: "var(--bg-secondary)",
                            color: "var(--text-secondary)",
                            fontFamily: "var(--font-montserrat)",
                          }}
                        >
                          {c.tipo}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedCliente && (
              <p
                className="mt-1.5 text-xs flex items-center gap-1"
                style={{ color: "#249689", fontFamily: "var(--font-montserrat)" }}
              >
                <Check size={12} /> Cliente selezionato
              </p>
            )}
          </div>

          {/* Veicolo picker */}
          {selectedCliente && (
            <div>
              <label
                className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
              >
                Veicolo{" "}
                <span style={{ fontWeight: 400, textTransform: "none" }}>
                  (opzionale)
                </span>
              </label>
              {loadingVeicoli ? (
                <div
                  className="flex items-center gap-2 text-sm py-2"
                  style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
                >
                  <Loader2 size={14} className="animate-spin" /> Caricamento
                  veicoli…
                </div>
              ) : veicoli.length === 0 ? (
                <p
                  className="text-sm py-2"
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-montserrat)",
                  }}
                >
                  Nessun veicolo registrato per questo cliente
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {veicoli.map((v) => {
                    const isSelected = selectedVeicolo?.id === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() =>
                          setSelectedVeicolo(isSelected ? null : v)
                        }
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors"
                        style={{
                          border: `1px solid ${isSelected ? "var(--brand)" : "var(--border)"}`,
                          background: isSelected ? "var(--brand)" : "#fff",
                          color: isSelected ? "#111" : "var(--text-primary)",
                          fontFamily: "var(--font-montserrat)",
                          fontWeight: 600,
                        }}
                      >
                        <Car size={13} />
                        {v.Targa}
                        {(v.Marca || v.Modello) && (
                          <span
                            style={{
                              fontWeight: 400,
                              fontSize: 12,
                              color: isSelected ? "#333" : "var(--text-muted)",
                            }}
                          >
                            {[v.Marca, v.Modello].filter(Boolean).join(" ")}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* ── Sezione 2: Pneumatici ── */}
      <Card>
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <FileText size={16} style={{ color: "var(--text-muted)" }} />
            <h2
              className="font-bold text-base"
              style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}
            >
              Pneumatici
            </h2>
          </div>
          <button
            type="button"
            onClick={addRiga}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-montserrat)",
            }}
          >
            <Plus size={13} /> Aggiungi
          </button>
        </div>

        <div className="space-y-3">
          {righe.map((riga, idx) => (
            <div
              key={riga.id}
              className="rounded-xl p-3"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
            >
              {/* Row header */}
              <div className="flex items-center justify-between mb-3">
                <span
                  className="text-xs font-semibold"
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-montserrat)",
                  }}
                >
                  Pneumatico {idx + 1}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAlgoliaModalFor(riga.id)}
                    className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg"
                    style={{
                      border: "1px solid var(--border)",
                      background: "#fff",
                      color: "var(--text-secondary)",
                      fontFamily: "var(--font-montserrat)",
                    }}
                  >
                    <Search size={11} /> Cerca catalogo
                  </button>
                  {righe.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRiga(riga.id)}
                      className="flex items-center justify-center w-6 h-6 rounded-lg"
                      style={{
                        background: "#FEF2F2",
                        color: "#991B1B",
                        border: "1px solid #FEE2E2",
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Fields grid */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <div className="col-span-1">
                  <label
                    className="block text-xs mb-1"
                    style={{
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-montserrat)",
                    }}
                  >
                    Marca
                  </label>
                  <input
                    type="text"
                    value={riga.Marca}
                    onChange={(e) => updateRiga(riga.id, "Marca", e.target.value)}
                    placeholder="Pirelli"
                    style={inputStyle}
                  />
                </div>
                <div className="sm:col-span-2 col-span-1">
                  <label
                    className="block text-xs mb-1"
                    style={{
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-montserrat)",
                    }}
                  >
                    Modello
                  </label>
                  <input
                    type="text"
                    value={riga.Modello}
                    onChange={(e) => updateRiga(riga.id, "Modello", e.target.value)}
                    placeholder="Cinturato P7"
                    style={inputStyle}
                  />
                </div>
                <div className="col-span-1">
                  <label
                    className="block text-xs mb-1"
                    style={{
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-montserrat)",
                    }}
                  >
                    Misura
                  </label>
                  <input
                    type="text"
                    value={riga.Misura}
                    onChange={(e) => updateRiga(riga.id, "Misura", e.target.value)}
                    placeholder="205/55 R16"
                    style={inputStyle}
                  />
                </div>
                <div className="col-span-1">
                  <label
                    className="block text-xs mb-1"
                    style={{
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-montserrat)",
                    }}
                  >
                    Qtà
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={riga.Quantita}
                    onChange={(e) =>
                      updateRiga(
                        riga.id,
                        "Quantita",
                        Math.max(1, parseInt(e.target.value) || 1)
                      )
                    }
                    style={inputStyle}
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label
                    className="block text-xs mb-1"
                    style={{
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-montserrat)",
                    }}
                  >
                    Prezzo unit. (€)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={riga.PrezzoUnitario}
                    onChange={(e) =>
                      updateRiga(riga.id, "PrezzoUnitario", e.target.value)
                    }
                    placeholder="0.00"
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Add row button (bottom) */}
        <button
          type="button"
          onClick={addRiga}
          className="mt-3 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-colors hover:bg-[#F8F9FB]"
          style={{
            border: "1.5px dashed var(--border)",
            color: "var(--text-muted)",
            fontFamily: "var(--font-montserrat)",
          }}
        >
          <Plus size={14} /> Aggiungi pneumatico
        </button>
      </Card>

      {/* ── Sezione 3: Note ── */}
      <Card>
        <h2
          className="font-bold text-base mb-4"
          style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}
        >
          Note
        </h2>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          placeholder="Aggiungi note libere per questo preventivo…"
          style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }}
        />
      </Card>

      {/* ── Sezione 4: Totale ── */}
      <Card>
        <div className="flex justify-end">
          <div
            className="w-full max-w-xs space-y-1.5 text-sm"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            <div className="flex justify-between">
              <span style={{ color: "var(--text-secondary)" }}>Subtotale</span>
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {euro(subtotale)}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: "var(--text-secondary)" }}>IVA 22%</span>
              <span style={{ color: "var(--text-secondary)" }}>
                {euro(subtotale * 0.22)}
              </span>
            </div>
            <div
              className="flex justify-between pt-2 text-base font-bold"
              style={{
                borderTop: "1px solid var(--border)",
                fontFamily: "var(--font-poppins)",
                color: "var(--text-primary)",
              }}
            >
              <span>Totale IVA incl.</span>
              <span>{euro(subtotale * 1.22)}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Actions ── */}
      <div className="flex items-center justify-between gap-3 pb-8">
        <Link
          href="/preventivi"
          className="text-sm font-medium px-4 py-2 rounded-xl"
          style={{
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
            fontFamily: "var(--font-montserrat)",
            background: "#fff",
          }}
        >
          Annulla
        </Link>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !selectedCliente}
          className="flex items-center gap-2 text-sm font-bold px-6 py-2.5 rounded-xl disabled:opacity-40 transition-opacity"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Check size={16} />
          )}
          {saving ? "Salvataggio…" : "Salva preventivo"}
        </button>
      </div>

      {/* ── Algolia search modal ── */}
      {algoliaModalFor && (
        <AlgoliaSearchModal
          onSelect={handleAlgoliaSelect}
          onClose={() => setAlgoliaModalFor(null)}
        />
      )}
    </div>
  );
}
