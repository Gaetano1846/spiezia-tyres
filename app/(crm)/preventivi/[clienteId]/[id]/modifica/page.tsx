"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  doc, getDoc, updateDoc, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  ArrowLeft, Plus, Trash2, Save,
} from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type Riga = {
  key: number;
  marca: string;
  modello: string;
  misura: string;
  quantita: number;
  prezzoUnitario: number;
  pfu: number;
};

type ServizioRiga = {
  key: number;
  titolo: string;
  prezzo: number;
  quantita: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawToRighe(raw: any): Riga[] {
  const src: any[] = raw.Pneumatici_Nuovi?.length
    ? raw.Pneumatici_Nuovi
    : raw.Articoli ?? [];
  return src.map((r, i) => ({
    key: i,
    marca:          r.Marca ?? r.marca ?? "",
    modello:        r.Modello ?? r.modello ?? r.Titolo ?? r.titolo ?? "",
    misura:         r.Misura ?? r.misura ?? "",
    quantita:       Number(r.Quantita ?? r.quantita ?? r.qta ?? 1),
    prezzoUnitario: Number(r.PrezzoUnitario ?? r.Prezzo ?? r.prezzoUnitario ?? 0),
    pfu:            Number(r.PFU ?? r.pfu ?? 0),
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawToServizi(raw: any): ServizioRiga[] {
  if (!Array.isArray(raw.Servizi)) return [];
  return raw.Servizi.map((s: any, i: number) => ({
    key:      i,
    titolo:   s.Titolo ?? s.titolo ?? "",
    prezzo:   Number(s.Prezzo ?? s.prezzo ?? s.PrezzoUnitario ?? 0),
    quantita: Number(s.Quantita ?? s.quantita ?? 1),
  }));
}

let _keySeq = 100;
const nextKey = () => ++_keySeq;

const STATI = ["In attesa", "Accettato", "Bozza", "Rifiutato"] as const;

// ─── Component ────────────────────────────────────────────────────────────────

export default function ModificaPreventivoPage() {
  const params    = useParams();
  const router    = useRouter();
  const clienteId = params.clienteId as string;
  const id        = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  // Form state
  const [stato,    setStato]   = useState("In attesa");
  const [note,     setNote]    = useState("");
  const [scadenza, setScadenza] = useState("");
  const [righe,    setRighe]   = useState<Riga[]>([]);
  const [servizi,  setServizi] = useState<ServizioRiga[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, "Clienti", clienteId, "Preventivo", id));
        if (!snap.exists()) { toast.error("Preventivo non trovato"); return; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = snap.data() as any;
        setStato(raw.Stato ?? (raw.Accettato ? "Accettato" : "In attesa"));
        setNote(raw.Note ?? raw.note ?? "");
        if (raw.DataScadenza?.toDate) {
          setScadenza(raw.DataScadenza.toDate().toISOString().slice(0, 10));
        }
        setRighe(rawToRighe(raw));
        setServizi(rawToServizi(raw));
      } catch (e) {
        console.error(e);
        toast.error("Errore nel caricamento");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [clienteId, id]);

  // ── Righe handlers ────────────────────────────────────────────────────────

  function addRiga() {
    setRighe((prev) => [
      ...prev,
      { key: nextKey(), marca: "", modello: "", misura: "", quantita: 1, prezzoUnitario: 0, pfu: 0 },
    ]);
  }

  function removeRiga(key: number) {
    setRighe((prev) => prev.filter((r) => r.key !== key));
  }

  function updateRiga<K extends keyof Riga>(key: number, field: K, value: Riga[K]) {
    setRighe((prev) => prev.map((r) => r.key === key ? { ...r, [field]: value } : r));
  }

  function addServizio() {
    setServizi((prev) => [...prev, { key: nextKey(), titolo: "", prezzo: 0, quantita: 1 }]);
  }

  function removeServizio(key: number) {
    setServizi((prev) => prev.filter((s) => s.key !== key));
  }

  function updateServizio<K extends keyof ServizioRiga>(key: number, field: K, value: ServizioRiga[K]) {
    setServizi((prev) => prev.map((s) => s.key === key ? { ...s, [field]: value } : s));
  }

  // ── Totali ────────────────────────────────────────────────────────────────

  const totaleRighe   = righe.reduce((s, r) => s + (r.prezzoUnitario + r.pfu) * r.quantita, 0);
  const totaleServizi = servizi.reduce((s, sv) => s + sv.prezzo * sv.quantita, 0);
  const imponibile    = totaleRighe + totaleServizi;
  const iva           = imponibile * 0.22;
  const totale        = imponibile + iva;

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    try {
      const articoliOut = righe.map((r) => ({
        Marca:          r.marca,
        Modello:        r.modello,
        Misura:         r.misura,
        Quantita:       r.quantita,
        PrezzoUnitario: r.prezzoUnitario,
        PFU:            r.pfu,
      }));
      const serviziOut = servizi.map((s) => ({
        Titolo:   s.titolo,
        Prezzo:   s.prezzo,
        Quantita: s.quantita,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patch: Record<string, any> = {
        Stato:           stato,
        Accettato:       stato === "Accettato",
        Articoli:        articoliOut,
        Pneumatici_Nuovi: articoliOut,   // keep both for backward compat
        Servizi:         serviziOut,
        Note:            note,
        Totale:          totale,
        IVA:             iva,
        _aggiornatoIl:   serverTimestamp(),
      };
      if (stato === "Accettato") patch.Data_Accettazione = serverTimestamp();
      if (stato !== "Accettato") patch.Data_Accettazione = null;
      if (scadenza) patch.DataScadenza = new Date(scadenza);

      await updateDoc(doc(db, "Clienti", clienteId, "Preventivo", id), patch);
      toast.success("Preventivo aggiornato");
      router.push(`/preventivi/${clienteId}/${id}`);
    } catch (e) {
      console.error(e);
      toast.error("Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  const inputCls = "w-full px-3 py-2 rounded-xl text-sm outline-none";
  const inputStyle = {
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-montserrat)",
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-5 animate-pulse">
        <div className="h-6 w-40 rounded-xl" style={{ background: "var(--bg-secondary)" }} />
        {[80, 300, 100].map((h, i) => (
          <div key={i} className="rounded-2xl" style={{ height: h, background: "var(--bg-secondary)", border: "1px solid var(--border)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link
        href={`/preventivi/${clienteId}/${id}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium"
        style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
      >
        <ArrowLeft size={15} /> Torna al preventivo
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
          Modifica preventivo
        </h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity hover:opacity-85"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
        >
          <Save size={15} />
          {saving ? "Salvataggio…" : "Salva modifiche"}
        </button>
      </div>

      {/* ── Stato & Scadenza ── */}
      <Card padding="sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              Stato
            </label>
            <select
              value={stato}
              onChange={(e) => setStato(e.target.value)}
              className={inputCls}
              style={{ ...inputStyle, border: "1.5px solid #FFC803" }}
            >
              {STATI.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              Scadenza
            </label>
            <input
              type="date"
              value={scadenza}
              onChange={(e) => setScadenza(e.target.value)}
              className={inputCls}
              style={inputStyle}
            />
          </div>
        </div>
      </Card>

      {/* ── Pneumatici / Articoli ── */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-base" style={{ fontFamily: "var(--font-poppins)" }}>
            Pneumatici
          </h2>
          <button
            onClick={addRiga}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors hover:opacity-80"
            style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
          >
            <Plus size={13} /> Aggiungi riga
          </button>
        </div>

        <div className="space-y-3">
          {righe.length === 0 && (
            <p className="text-sm text-center py-4" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              Nessun pneumatico. Clicca "Aggiungi riga".
            </p>
          )}
          {righe.map((r) => (
            <div key={r.key} className="p-3 rounded-xl space-y-2" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
              <div className="grid grid-cols-3 gap-2">
                <input
                  placeholder="Marca"
                  value={r.marca}
                  onChange={(e) => updateRiga(r.key, "marca", e.target.value)}
                  className={inputCls}
                  style={inputStyle}
                />
                <input
                  placeholder="Modello"
                  value={r.modello}
                  onChange={(e) => updateRiga(r.key, "modello", e.target.value)}
                  className={`${inputCls} col-span-2`}
                  style={inputStyle}
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                <input
                  placeholder="Misura (es. 205/55R16)"
                  value={r.misura}
                  onChange={(e) => updateRiga(r.key, "misura", e.target.value)}
                  className={`${inputCls} col-span-2`}
                  style={inputStyle}
                />
                <input
                  type="number"
                  min={1}
                  placeholder="Qtà"
                  value={r.quantita}
                  onChange={(e) => updateRiga(r.key, "quantita", Number(e.target.value))}
                  className={inputCls}
                  style={inputStyle}
                />
                <button
                  onClick={() => removeRiga(r.key)}
                  className="flex items-center justify-center rounded-xl transition-colors hover:bg-red-50"
                  style={{ border: "1px solid #FEE2E2", color: "#EF4444" }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>Prezzo unitario (€)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={r.prezzoUnitario}
                    onChange={(e) => updateRiga(r.key, "prezzoUnitario", Number(e.target.value))}
                    className={inputCls}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>PFU (€)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={r.pfu}
                    onChange={(e) => updateRiga(r.key, "pfu", Number(e.target.value))}
                    className={inputCls}
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Servizi ── */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-base" style={{ fontFamily: "var(--font-poppins)" }}>
            Servizi
          </h2>
          <button
            onClick={addServizio}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors hover:opacity-80"
            style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
          >
            <Plus size={13} /> Aggiungi servizio
          </button>
        </div>
        <div className="space-y-2">
          {servizi.length === 0 && (
            <p className="text-sm text-center py-3" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              Nessun servizio aggiunto.
            </p>
          )}
          {servizi.map((s) => (
            <div key={s.key} className="grid grid-cols-4 gap-2 items-center">
              <input
                placeholder="Descrizione servizio"
                value={s.titolo}
                onChange={(e) => updateServizio(s.key, "titolo", e.target.value)}
                className={`${inputCls} col-span-2`}
                style={inputStyle}
              />
              <input
                type="number"
                min={0}
                step={0.01}
                placeholder="Prezzo"
                value={s.prezzo}
                onChange={(e) => updateServizio(s.key, "prezzo", Number(e.target.value))}
                className={inputCls}
                style={inputStyle}
              />
              <button
                onClick={() => removeServizio(s.key)}
                className="flex items-center justify-center py-2 rounded-xl transition-colors hover:bg-red-50"
                style={{ border: "1px solid #FEE2E2", color: "#EF4444" }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Note ── */}
      <Card padding="sm">
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
          Note
        </label>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note aggiuntive…"
          className={`${inputCls} resize-none`}
          style={inputStyle}
        />
      </Card>

      {/* ── Totali ── */}
      <Card>
        <div className="flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
            <div className="flex justify-between">
              <span style={{ color: "var(--text-secondary)" }}>Imponibile</span>
              <span style={{ color: "var(--text-primary)" }}>
                {imponibile.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: "var(--text-secondary)" }}>IVA 22%</span>
              <span style={{ color: "var(--text-primary)" }}>
                {iva.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}
              </span>
            </div>
            <div className="flex justify-between pt-2 text-base font-bold" style={{ borderTop: "1px solid var(--border)", fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
              <span>Totale</span>
              <span>{totale.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Bottom save ── */}
      <div className="flex justify-end pb-8">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity hover:opacity-85"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
        >
          <Save size={15} />
          {saving ? "Salvataggio…" : "Salva modifiche"}
        </button>
      </div>
    </div>
  );
}
