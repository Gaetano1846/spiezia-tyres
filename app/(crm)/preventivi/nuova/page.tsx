"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  getDocs,
  doc,
  addDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  limit,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Plus,
  Trash2,
  X,
  Search,
  ChevronDown,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";
import type { Cliente, Veicolo } from "@/lib/types";

type Articolo = {
  id: number;
  descrizione: string;
  marca: string;
  qta: number;
  prezzoUnitario: number;
  pfu: number;
};

const steps = ["Cliente & Veicolo", "Articoli", "Riepilogo"] as const;

export default function NuovoPreventivoPage() {
  const router = useRouter();

  // Step state
  const [step, setStep] = useState(0);

  // Step 0 — Cliente & Veicolo
  const [clienti, setClienti] = useState<Cliente[]>([]);
  const [clientiLoading, setClientiLoading] = useState(true);
  const [clienteSearch, setClienteSearch] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);
  const [veicoli, setVeicoli] = useState<Veicolo[]>([]);
  const [veicoliLoading, setVeicoliLoading] = useState(false);
  const [veicoloId, setVeicoloId] = useState("");
  const [km, setKm] = useState("");

  // Step 1 — Articoli
  const [articoli, setArticoli] = useState<Articolo[]>([
    { id: 1, descrizione: "", marca: "", qta: 1, prezzoUnitario: 0, pfu: 0 },
  ]);

  // Step 2 — Riepilogo
  const [note, setNote] = useState("");
  const [scadenza, setScadenza] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Load Clienti (no orderBy → avoids missing-field exclusion) ───────────
  useEffect(() => {
    const fetchClienti = async () => {
      try {
        const snap = await getDocs(query(collection(db, "Clienti"), limit(500)));
        const list: Cliente[] = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Cliente, "id">) }))
          .sort((a, b) => {
            const na = (a.Azienda && a.Ragione_Sociale ? a.Ragione_Sociale : a.Nome) ?? "";
            const nb = (b.Azienda && b.Ragione_Sociale ? b.Ragione_Sociale : b.Nome) ?? "";
            return na.localeCompare(nb, "it");
          });
        setClienti(list);
      } catch (err) {
        console.error(err);
        toast.error("Errore nel caricamento dei clienti");
      } finally {
        setClientiLoading(false);
      }
    };
    fetchClienti();
  }, []);

  // Chiudi dropdown su click fuori
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Load Veicoli when cliente changes ─────────────────────────────────────
  useEffect(() => {
    if (!clienteId) {
      setVeicoli([]);
      setVeicoloId("");
      return;
    }
    const fetchVeicoli = async () => {
      setVeicoliLoading(true);
      try {
        const snap = await getDocs(
          collection(db, "Clienti", clienteId, "Veicolo")
        );
        const list: Veicolo[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Veicolo, "id">),
        }));
        setVeicoli(list);
      } catch (err) {
        console.error(err);
        toast.error("Errore nel caricamento dei veicoli");
      } finally {
        setVeicoliLoading(false);
      }
    };
    fetchVeicoli();
  }, [clienteId]);

  // ── Derived values ────────────────────────────────────────────────────────
  function clienteLabel(c: Cliente): string {
    return (c.Azienda && c.Ragione_Sociale ? c.Ragione_Sociale : c.Nome) ?? "—";
  }

  const clientiFiltrati = clienti.filter((c) => {
    if (!clienteSearch.trim()) return true;
    const q = clienteSearch.toLowerCase();
    return (
      c.Nome?.toLowerCase().includes(q) ||
      c.Ragione_Sociale?.toLowerCase().includes(q) ||
      c.Email?.toLowerCase().includes(q) ||
      c.Telefono?.toLowerCase().includes(q)
    );
  });

  const clienteSelezionato = clienti.find((c) => c.id === clienteId) ?? null;
  const veicoloSelezionato = veicoli.find((v) => v.id === veicoloId) ?? null;

  const totaleNetto = articoli.reduce(
    (acc, a) => acc + a.qta * a.prezzoUnitario,
    0
  );
  const totalePFU = articoli.reduce((acc, a) => acc + a.qta * a.pfu, 0);
  const iva = (totaleNetto + totalePFU) * 0.22;
  const totaleFinale = totaleNetto + totalePFU + iva;

  // ── Articoli helpers ──────────────────────────────────────────────────────
  const addArticolo = () =>
    setArticoli((prev) => [
      ...prev,
      { id: Date.now(), descrizione: "", marca: "", qta: 1, prezzoUnitario: 0, pfu: 0 },
    ]);

  const removeArticolo = (id: number) =>
    setArticoli((prev) => prev.filter((a) => a.id !== id));

  const updateArticolo = (
    id: number,
    field: keyof Articolo,
    value: string | number
  ) =>
    setArticoli((prev) =>
      prev.map((a) => (a.id === id ? { ...a, [field]: value } : a))
    );

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleConferma = async () => {
    if (!clienteId) {
      toast.error("Seleziona un cliente");
      return;
    }
    setSaving(true);
    try {
      // 1. Generate Numero via transaction on Counters/preventivi
      const counterRef = doc(db, "Counters", "preventivi");
      let numero = "";
      await runTransaction(db, async (tx) => {
        const counterSnap = await tx.get(counterRef);
        const current: number = counterSnap.exists()
          ? (counterSnap.data().ultimo as number) ?? 0
          : 0;
        const next = current + 1;
        tx.set(counterRef, { ultimo: next }, { merge: true });
        numero = `PRE-${String(next).padStart(4, "0")}`;
      });

      // 2. Build document
      const clienteRef = doc(db, "Clienti", clienteId);
      const veicoloRef =
        veicoloId
          ? doc(db, "Clienti", clienteId, "Veicolo", veicoloId)
          : undefined;

      const articoliPersisted = articoli.map((a) => ({
        Prodotto: "",
        Titolo: a.descrizione,
        Marca: a.marca,
        Quantita: a.qta,
        PrezzoUnitario: a.prezzoUnitario,
        PFU: a.pfu,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docData: Record<string, any> = {
        Numero: numero,
        Cliente: clienteRef,
        Stato: "Bozza",
        Articoli: articoliPersisted,
        Servizi: [],
        Totale: totaleFinale,
        IVA: iva,
        PFU: totalePFU,
        Note: note,
        DataCreazione: serverTimestamp(),
      };

      if (veicoloRef) docData.Veicolo = veicoloRef;
      if (scadenza) docData.DataScadenza = Timestamp.fromDate(new Date(scadenza));

      // 3. Save to Clienti/{clienteId}/Preventivo
      const prevRef = collection(db, "Clienti", clienteId, "Preventivo");
      const newDoc = await addDoc(prevRef, docData);

      toast.success(`Preventivo ${numero} creato`);
      router.push(`/preventivi/${clienteId}/${newDoc.id}`);
    } catch (err) {
      console.error(err);
      toast.error("Errore nel salvataggio del preventivo");
      setSaving(false);
    }
  };

  // ── Shared input style ────────────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    fontFamily: "var(--font-montserrat)",
    color: "var(--text-primary)",
    outline: "none",
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div
        className="flex items-center gap-2 text-sm"
        style={{
          fontFamily: "var(--font-montserrat)",
          color: "var(--text-secondary)",
        }}
      >
        <Link href="/preventivi" className="hover:underline">
          Preventivi
        </Link>
        <span>/</span>
        <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
          Nuovo
        </span>
      </div>

      <div className="flex items-center justify-between">
        <h1
          className="text-2xl font-bold"
          style={{
            fontFamily: "var(--font-poppins)",
            color: "var(--text-primary)",
          }}
        >
          Nuovo preventivo
        </h1>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold"
              style={{
                background:
                  i < step
                    ? "#249689"
                    : i === step
                    ? "var(--brand)"
                    : "var(--border)",
                color: i <= step ? "#111" : "var(--text-muted)",
                fontFamily: "var(--font-montserrat)",
              }}
            >
              {i < step ? <Check size={12} /> : i + 1}
            </div>
            <span
              className="text-xs font-semibold hidden sm:block"
              style={{
                color:
                  i === step ? "var(--text-primary)" : "var(--text-muted)",
                fontFamily: "var(--font-montserrat)",
              }}
            >
              {s}
            </span>
            {i < steps.length - 1 && (
              <div
                className="w-8 h-px mx-1"
                style={{ background: "var(--border)" }}
              />
            )}
          </div>
        ))}
      </div>

      <Card>
        {/* ── STEP 0: Cliente & Veicolo ───────────────────────────────────── */}
        {step === 0 && (
          <div className="space-y-5">
            <h2
              className="font-bold text-base"
              style={{ fontFamily: "var(--font-poppins)" }}
            >
              Cliente & Veicolo
            </h2>

            {/* Combobox cercabile cliente */}
            <div className="space-y-2" ref={comboRef}>
              <label
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
              >
                Cliente *
              </label>

              {clientiLoading ? (
                <div className="flex items-center gap-2 text-sm py-2.5" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  <Loader2 size={14} className="animate-spin" />
                  Caricamento clienti…
                </div>
              ) : (
                <div className="relative">
                  {/* Input */}
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
                    <input
                      type="text"
                      value={clienteId ? clienteLabel(clienteSelezionato!) : clienteSearch}
                      readOnly={!!clienteId}
                      onChange={(e) => {
                        setClienteSearch(e.target.value);
                        setClienteId("");
                        setVeicoloId("");
                        setShowDropdown(true);
                      }}
                      onFocus={() => { if (!clienteId) setShowDropdown(true); }}
                      placeholder="Cerca per nome, ragione sociale, email…"
                      className="w-full pl-9 pr-9 py-2.5 rounded-xl text-sm"
                      style={{ ...inputStyle, cursor: clienteId ? "default" : "text" }}
                    />
                    {clienteId ? (
                      <button
                        onClick={() => { setClienteId(""); setClienteSearch(""); setVeicoloId(""); setShowDropdown(false); }}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                      >
                        <X size={14} style={{ color: "var(--text-muted)" }} />
                      </button>
                    ) : clienteSearch ? (
                      <button
                        onClick={() => { setClienteSearch(""); setShowDropdown(false); }}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                      >
                        <X size={14} style={{ color: "var(--text-muted)" }} />
                      </button>
                    ) : null}
                  </div>

                  {/* Dropdown risultati */}
                  {showDropdown && !clienteId && (
                    <div
                      className="absolute z-30 w-full mt-1 rounded-xl overflow-hidden"
                      style={{ background: "#fff", border: "1px solid var(--border)", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", maxHeight: 280, overflowY: "auto" }}
                    >
                      {clientiFiltrati.length === 0 ? (
                        <div className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                          Nessun cliente trovato
                        </div>
                      ) : (
                        clientiFiltrati.slice(0, 50).map((c) => (
                          <button
                            key={c.id}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setClienteId(c.id);
                              setClienteSearch("");
                              setVeicoloId("");
                              setShowDropdown(false);
                            }}
                            className="w-full text-left px-4 py-2.5 transition-colors hover:bg-[#FFF8DC]"
                            style={{ fontFamily: "var(--font-montserrat)", borderBottom: "1px solid var(--border)" }}
                          >
                            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                              {clienteLabel(c)}
                            </p>
                            {c.Email && (
                              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{c.Email}</p>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Veicolo select — shown when cliente is selected */}
            {clienteId && (
              <div className="space-y-2">
                <label
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-montserrat)",
                  }}
                >
                  Veicolo
                </label>
                {veicoliLoading ? (
                  <div
                    className="flex items-center gap-2 text-sm py-2"
                    style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
                  >
                    <Loader2 size={14} className="animate-spin" />
                    Caricamento veicoli...
                  </div>
                ) : (
                  <div className="relative">
                    <select
                      value={veicoloId}
                      onChange={(e) => setVeicoloId(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl text-sm appearance-none pr-9"
                      style={inputStyle}
                    >
                      <option value="">Seleziona veicolo...</option>
                      {veicoli.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.Targa} — {v.Marca} {v.Modello}
                          {v.Anno ? ` (${v.Anno})` : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={15}
                      className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ color: "var(--text-muted)" }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Chilometraggio */}
            <div className="space-y-2">
              <label
                className="text-xs font-semibold uppercase tracking-wider"
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-montserrat)",
                }}
              >
                Chilometraggio
              </label>
              <input
                type="number"
                value={km}
                onChange={(e) => setKm(e.target.value)}
                placeholder="es. 45000"
                className="w-full px-4 py-2.5 rounded-xl text-sm"
                style={inputStyle}
              />
            </div>
          </div>
        )}

        {/* ── STEP 1: Articoli ────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-5">
            <h2
              className="font-bold text-base"
              style={{ fontFamily: "var(--font-poppins)" }}
            >
              Articoli
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {[
                      "Descrizione",
                      "Marca",
                      "Qtà",
                      "Prezzo unit.",
                      "PFU",
                      "Totale",
                      "",
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left pb-3 px-2 text-xs font-semibold uppercase tracking-wider"
                        style={{
                          color: "var(--text-muted)",
                          fontFamily: "var(--font-montserrat)",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {articoli.map((a) => (
                    <tr
                      key={a.id}
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <td className="px-2 py-2">
                        <input
                          type="text"
                          value={a.descrizione}
                          onChange={(e) =>
                            updateArticolo(a.id, "descrizione", e.target.value)
                          }
                          placeholder="Descrizione articolo o servizio"
                          className="w-full px-3 py-1.5 rounded-lg text-sm"
                          style={inputStyle}
                        />
                      </td>
                      <td className="px-2 py-2 w-28">
                        <input
                          type="text"
                          value={a.marca}
                          onChange={(e) =>
                            updateArticolo(a.id, "marca", e.target.value)
                          }
                          placeholder="Marca"
                          className="w-full px-3 py-1.5 rounded-lg text-sm"
                          style={inputStyle}
                        />
                      </td>
                      <td className="px-2 py-2 w-16">
                        <input
                          type="number"
                          min={1}
                          value={a.qta}
                          onChange={(e) =>
                            updateArticolo(
                              a.id,
                              "qta",
                              Number(e.target.value)
                            )
                          }
                          className="w-full px-3 py-1.5 rounded-lg text-sm text-center"
                          style={inputStyle}
                        />
                      </td>
                      <td className="px-2 py-2 w-28">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={a.prezzoUnitario}
                          onChange={(e) =>
                            updateArticolo(
                              a.id,
                              "prezzoUnitario",
                              Number(e.target.value)
                            )
                          }
                          className="w-full px-3 py-1.5 rounded-lg text-sm"
                          style={inputStyle}
                        />
                      </td>
                      <td className="px-2 py-2 w-24">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={a.pfu}
                          onChange={(e) =>
                            updateArticolo(
                              a.id,
                              "pfu",
                              Number(e.target.value)
                            )
                          }
                          className="w-full px-3 py-1.5 rounded-lg text-sm"
                          style={inputStyle}
                        />
                      </td>
                      <td
                        className="px-2 py-2 font-semibold w-24 whitespace-nowrap"
                        style={{
                          fontFamily: "var(--font-montserrat)",
                          color: "var(--text-primary)",
                        }}
                      >
                        € {(a.qta * a.prezzoUnitario).toFixed(2)}
                      </td>
                      <td className="px-2 py-2 w-8">
                        {articoli.length > 1 && (
                          <button
                            onClick={() => removeArticolo(a.id)}
                            style={{ color: "var(--text-muted)" }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={addArticolo}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl"
              style={{
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
                fontFamily: "var(--font-montserrat)",
              }}
            >
              <Plus size={14} />
              Aggiungi riga
            </button>

            <div className="flex justify-end">
              <div
                className="text-right space-y-1 min-w-[200px]"
                style={{ fontFamily: "var(--font-montserrat)" }}
              >
                <p
                  className="text-sm"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Netto:{" "}
                  <strong>€ {totaleNetto.toFixed(2)}</strong>
                </p>
                <p
                  className="text-sm"
                  style={{ color: "var(--text-secondary)" }}
                >
                  PFU:{" "}
                  <strong>€ {totalePFU.toFixed(2)}</strong>
                </p>
                <p
                  className="text-sm"
                  style={{ color: "var(--text-secondary)" }}
                >
                  IVA 22%:{" "}
                  <strong>€ {iva.toFixed(2)}</strong>
                </p>
                <p
                  className="text-base font-bold"
                  style={{
                    fontFamily: "var(--font-poppins)",
                    color: "var(--text-primary)",
                  }}
                >
                  Totale: € {totaleFinale.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2: Riepilogo ───────────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-5">
            <h2
              className="font-bold text-base"
              style={{ fontFamily: "var(--font-poppins)" }}
            >
              Riepilogo
            </h2>

            {/* Summary card */}
            <div
              className="rounded-xl p-4 space-y-2"
              style={{
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              <div
                className="flex justify-between text-sm"
                style={{ fontFamily: "var(--font-montserrat)" }}
              >
                <span style={{ color: "var(--text-muted)" }}>Cliente</span>
                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                  {clienteSelezionato ? clienteLabel(clienteSelezionato) : "—"}
                </span>
              </div>
              {veicoloSelezionato && (
                <div
                  className="flex justify-between text-sm"
                  style={{ fontFamily: "var(--font-montserrat)" }}
                >
                  <span style={{ color: "var(--text-muted)" }}>Veicolo</span>
                  <span
                    style={{ color: "var(--text-primary)", fontWeight: 600 }}
                  >
                    {veicoloSelezionato.Targa} — {veicoloSelezionato.Marca}{" "}
                    {veicoloSelezionato.Modello}
                  </span>
                </div>
              )}
              <div
                className="flex justify-between text-sm"
                style={{ fontFamily: "var(--font-montserrat)" }}
              >
                <span style={{ color: "var(--text-muted)" }}>Articoli</span>
                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                  {articoli.length}
                </span>
              </div>

              <div
                className="pt-2 mt-2 space-y-1"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <div
                  className="flex justify-between text-sm"
                  style={{ fontFamily: "var(--font-montserrat)" }}
                >
                  <span style={{ color: "var(--text-muted)" }}>Netto</span>
                  <span style={{ color: "var(--text-primary)" }}>
                    € {totaleNetto.toFixed(2)}
                  </span>
                </div>
                <div
                  className="flex justify-between text-sm"
                  style={{ fontFamily: "var(--font-montserrat)" }}
                >
                  <span style={{ color: "var(--text-muted)" }}>PFU</span>
                  <span style={{ color: "var(--text-primary)" }}>
                    € {totalePFU.toFixed(2)}
                  </span>
                </div>
                <div
                  className="flex justify-between text-sm"
                  style={{ fontFamily: "var(--font-montserrat)" }}
                >
                  <span style={{ color: "var(--text-muted)" }}>IVA 22%</span>
                  <span style={{ color: "var(--text-primary)" }}>
                    € {iva.toFixed(2)}
                  </span>
                </div>
                <div
                  className="flex justify-between text-base font-bold"
                  style={{ fontFamily: "var(--font-poppins)" }}
                >
                  <span style={{ color: "var(--text-primary)" }}>
                    Totale (IVA incl.)
                  </span>
                  <span style={{ color: "var(--text-primary)" }}>
                    € {totaleFinale.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Scadenza */}
            <div className="space-y-2">
              <label
                className="text-xs font-semibold uppercase tracking-wider"
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-montserrat)",
                }}
              >
                Scadenza preventivo
              </label>
              <input
                type="date"
                value={scadenza}
                onChange={(e) => setScadenza(e.target.value)}
                className="px-4 py-2.5 rounded-xl text-sm"
                style={inputStyle}
              />
            </div>

            {/* Note */}
            <div className="space-y-2">
              <label
                className="text-xs font-semibold uppercase tracking-wider"
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-montserrat)",
                }}
              >
                Note interne
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                placeholder="Aggiungi note o condizioni particolari..."
                className="w-full rounded-xl p-3 text-sm resize-none"
                style={inputStyle}
              />
            </div>
          </div>
        )}

        {/* ── Navigation ──────────────────────────────────────────────────── */}
        <div
          className="flex justify-between mt-6 pt-4"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-40"
            style={{
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-montserrat)",
            }}
          >
            <ArrowLeft size={14} />
            Indietro
          </button>

          {step < steps.length - 1 ? (
            <button
              onClick={() =>
                setStep((s) => Math.min(steps.length - 1, s + 1))
              }
              disabled={step === 0 && !clienteId}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-40"
              style={{
                background: "var(--brand)",
                color: "#111",
                fontFamily: "var(--font-montserrat)",
              }}
            >
              Avanti
              <ArrowRight size={14} />
            </button>
          ) : (
            <button
              onClick={handleConferma}
              disabled={saving}
              className="flex items-center gap-2 text-sm font-semibold px-5 py-2 rounded-xl disabled:opacity-60"
              style={{
                background: "var(--brand)",
                color: "#111",
                fontFamily: "var(--font-montserrat)",
              }}
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Salvataggio...
                </>
              ) : (
                <>
                  <Check size={14} />
                  Conferma preventivo
                </>
              )}
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
