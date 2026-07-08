"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, addDoc, updateDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { nextCounter } from "@/lib/counters";
import {
  ArrowLeft, Download, CheckCircle2, XCircle, Car, User, FileText, Wrench,
  ShoppingCart, Loader2, Printer,
} from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import toast from "react-hot-toast";
import type { PreventivoApi } from "@/lib/preventiviDb";

type ServizioDisplay = { titolo: string; prezzo: number; quantita: number };

function euro(n: number | undefined | null): string {
  if (n == null) return "—";
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function fmtIso(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
}

function getNumero(p: PreventivoApi): string {
  if (p.Numero != null) return `#${p.Numero}`;
  return `#${p.id.slice(0, 6).toUpperCase()}`;
}

function getStato(p: PreventivoApi): "Accettato" | "In attesa" {
  return p.Accettato ? "Accettato" : "In attesa";
}

function getServizi(p: PreventivoApi): ServizioDisplay[] {
  return p.Servizi.map((raw) => {
    const s = raw as Record<string, unknown>;
    return {
      titolo:   (s.Titolo as string) || (s.titolo as string) || "Servizio",
      prezzo:   Number(s.Prezzo ?? s.prezzoUnitario ?? s.PrezzoUnitario ?? 0),
      quantita: Number(s.Quantita ?? s.quantita ?? 1),
    };
  }).filter((s) => s.prezzo > 0 || s.titolo !== "Servizio");
}

function badgeVariant(stato: string): "success" | "neutral" {
  return stato === "Accettato" ? "success" : "neutral";
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PreventivoDetailPage() {
  const params    = useParams();
  const router    = useRouter();
  const clienteId = params.clienteId as string;
  const id        = params.id as string;

  const [preventivo, setPreventivo] = useState<PreventivoApi | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [converting,  setConverting]  = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/preventivi/${clienteId}/${id}`);
        if (!res.ok) { toast.error("Preventivo non trovato"); return; }
        const { preventivo: p } = await res.json();
        setPreventivo(p);
      } catch (e) {
        toast.error("Errore nel caricamento preventivo");
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [clienteId, id]);

  async function handleAccetta() {
    if (!preventivo || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/preventivi/${clienteId}/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accettato: true }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setPreventivo({ ...preventivo, Accettato: true });
      toast.success("Preventivo segnato come accettato");
    } catch { toast.error("Errore aggiornamento"); }
    finally { setSaving(false); }
  }

  async function handleRifiuta() {
    if (!preventivo || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/preventivi/${clienteId}/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accettato: false }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setPreventivo({ ...preventivo, Accettato: false, DataAccettazione: null });
      toast.success("Preventivo rimesso in attesa");
    } catch { toast.error("Errore aggiornamento"); }
    finally { setSaving(false); }
  }

  // "Converti in Ordine" resta VOLUTAMENTE Firestore diretto — crea un
  // documento in Ordini, dominio esplicitamente escluso da questa
  // migrazione. Il bridge propaga comunque Convertito/OrdineId verso
  // fs_extra su Postgres (letti sopra per il guard anti-doppia-conversione).
  async function handleConvertToOrder() {
    if (!preventivo || converting) return;
    if (preventivo.OrdineId || preventivo.Convertito) {
      toast.error("Questo preventivo è già stato convertito in ordine");
      return;
    }
    const round2 = (x: number) => Math.round(x * 100) / 100;
    setConverting(true);
    try {
      const arts = preventivo.Articoli;
      const servs = getServizi(preventivo);

      const totArticoli = arts.reduce(
        (s, a) => s + ((a.PrezzoUnitario ?? 0) + (a.PFU ?? 0)) * (a.Quantita ?? 0),
        0
      );
      const totPfu = arts.reduce((s, a) => s + (a.PFU ?? 0) * (a.Quantita ?? 0), 0);
      const totServizi = servs.reduce((s, sv) => s + sv.prezzo * sv.quantita, 0);
      const imponibile = totArticoli + totServizi;
      const iva = imponibile * 0.22;
      const totale = imponibile + iva; // lordo, coerente col modello Ordini B2B

      const articoliOrdine = arts.map((a) => ({
        Prodotto: a.Misura ?? "",
        Titolo: a.Modello ?? "",
        Marca: a.Marca ?? "",
        Quantita: a.Quantita ?? 0,
        PrezzoUnitario: a.PrezzoUnitario ?? 0,
        PFU: a.PFU ?? 0,
      }));

      const sedeId = preventivo.SedeId ?? "main";
      const n = await nextCounter("Ordine", sedeId);
      const year = new Date().getFullYear();

      const payload = {
        Numero: `ORD-${year}-${String(n).padStart(5, "0")}`,
        Cliente: doc(db, "Clienti", clienteId),
        Source: "B2B",
        Stato: "In Lavorazione",
        Articoli: articoliOrdine,
        Totale: round2(totale),
        IVA: round2(iva),
        PFU: round2(totPfu),
        Note: preventivo.Note ?? null,
        DataCreazione: serverTimestamp(),
      };

      const ordineRef = await addDoc(collection(db, "Ordini"), payload);
      // Marca il preventivo come convertito per impedire una seconda conversione.
      await updateDoc(doc(db, "Clienti", clienteId, "Preventivo", id), {
        Convertito: true,
        OrdineId: ordineRef.id,
      });
      setPreventivo({ ...preventivo, Convertito: true, OrdineId: ordineRef.id });
      toast.success("Ordine creato con successo");
      router.push("/ordini");
    } catch (e) {
      console.error(e);
      toast.error("Errore nella creazione dell'ordine");
    } finally {
      setConverting(false);
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-5 animate-pulse">
        <div className="h-6 w-40 rounded-xl" style={{ background: "var(--bg-secondary)" }} />
        {[100, 140, 220, 80].map((h, i) => (
          <div key={i} className="rounded-2xl" style={{ height: h, background: "var(--bg-secondary)", border: "1px solid var(--border)" }} />
        ))}
      </div>
    );
  }

  if (!preventivo) {
    return (
      <div className="text-center py-20" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
        <p className="text-sm">Preventivo non trovato.</p>
        <Link href="/preventivi" className="text-sm font-semibold mt-3 inline-block" style={{ color: "var(--brand)" }}>
          ← Torna ai preventivi
        </Link>
      </div>
    );
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const numero   = getNumero(preventivo);
  const stato    = getStato(preventivo);
  const articoli = preventivo.Articoli;
  const servizi  = getServizi(preventivo);
  const note     = preventivo.Note ?? "";

  const totaleArticoli = articoli.reduce(
    (s, a) => s + ((a.PrezzoUnitario ?? 0) + (a.PFU ?? 0)) * (a.Quantita ?? 0),
    0
  );
  const totaleServizi = servizi.reduce((s, sv) => s + sv.prezzo * sv.quantita, 0);
  const imponibile    = totaleArticoli + totaleServizi;
  const iva           = imponibile * 0.22;
  const totale        = imponibile + iva;

  const isAccettato = stato === "Accettato";

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link
        href="/preventivi"
        className="inline-flex items-center gap-1.5 text-sm font-medium"
        style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
      >
        <ArrowLeft size={15} /> Preventivi
      </Link>

      {/* ── Header ── */}
      <Card>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                {numero}
              </h1>
              <Badge variant={badgeVariant(stato)}>{stato}</Badge>
            </div>
            <div className="flex flex-col gap-0.5 text-sm" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
              {preventivo.Data
                ? <span>Data: <strong>{preventivo.Data}</strong></span>
                : <span>Creato il <strong>{fmtIso(preventivo.DataCreazione)}</strong></span>
              }
              {preventivo.DataAccettazione && (
                <span>Accettato il <strong>{fmtIso(preventivo.DataAccettazione)}</strong></span>
              )}
              {preventivo.DataScadenza && (
                <span style={{ color: "#EF4444" }}>
                  Scadenza: <strong>{fmtIso(preventivo.DataScadenza)}</strong>
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href={`/preventivi/${clienteId}/${id}/stampa`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl"
              style={{ border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-montserrat)", background: "#fff" }}
            >
              <Printer size={13} /> Stampa / PDF
            </Link>
            {preventivo.PdfUrl && (
              <a
                href={preventivo.PdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl"
                style={{ border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-montserrat)", background: "#fff" }}
              >
                <Download size={13} /> PDF salvato
              </a>
            )}
            {!isAccettato && (
              <button
                onClick={handleAccetta}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl disabled:opacity-40"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                <CheckCircle2 size={13} /> Segna accettato
              </button>
            )}
            {isAccettato && (
              <button
                onClick={handleRifiuta}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl disabled:opacity-40"
                style={{ border: "1px solid #FEE2E2", background: "#FEF2F2", color: "#991B1B", fontFamily: "var(--font-montserrat)" }}
              >
                <XCircle size={13} /> Annulla accettazione
              </button>
            )}
            {isAccettato && (
              <button
                onClick={handleConvertToOrder}
                disabled={converting || !!(preventivo.OrdineId || preventivo.Convertito)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl disabled:opacity-40"
                style={{ background: "#1D4ED8", color: "#fff", fontFamily: "var(--font-montserrat)" }}
              >
                {converting
                  ? <Loader2 size={13} className="animate-spin" />
                  : <ShoppingCart size={13} />
                }
                {preventivo.OrdineId || preventivo.Convertito ? "Già convertito" : "Converti in Ordine"}
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* ── Cliente + Veicolo ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card padding="sm">
          <div className="flex items-center gap-2 mb-3">
            <User size={14} style={{ color: "var(--text-muted)" }} />
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              Cliente
            </p>
          </div>
          <div className="space-y-1 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
            <p className="font-bold text-base" style={{ color: "var(--text-primary)" }}>{preventivo.ClienteNome}</p>
            {preventivo.ClienteCodiceFiscale && (
              <p className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>{preventivo.ClienteCodiceFiscale}</p>
            )}
            {preventivo.ClienteTelefono && (
              <p style={{ color: "var(--text-secondary)" }}>{preventivo.ClienteTelefono}</p>
            )}
            {preventivo.ClienteEmail && (
              <p style={{ color: "var(--text-muted)" }}>{preventivo.ClienteEmail}</p>
            )}
            <Link href={`/clienti/${clienteId}`} className="text-xs font-semibold mt-2 inline-block" style={{ color: "#2563EB" }}>
              Scheda cliente →
            </Link>
          </div>
        </Card>

        <Card padding="sm">
          <div className="flex items-center gap-2 mb-3">
            <Car size={14} style={{ color: "var(--text-muted)" }} />
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              Veicolo
            </p>
          </div>
          {preventivo.VeicoloId ? (
            <div className="space-y-1 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
              <p className="text-xl font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)", letterSpacing: "0.05em" }}>
                {preventivo.VeicoloTarga}
              </p>
              <p style={{ color: "var(--text-secondary)" }}>
                {[preventivo.VeicoloMarca, preventivo.VeicoloModello, preventivo.VeicoloAnno].filter(Boolean).join(" ")}
              </p>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>Nessun veicolo associato</p>
          )}
        </Card>
      </div>

      {/* ── Pneumatici / Articoli ── */}
      {articoli.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <FileText size={16} style={{ color: "var(--text-muted)" }} />
            <h2 className="font-bold text-base" style={{ fontFamily: "var(--font-poppins)" }}>Pneumatici</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Marca", "Modello", "Misura", "Qtà", "Prezzo unit.", "Totale"].map((h) => (
                    <th key={h} className="text-left pb-3 px-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {articoli.map((a, i) => {
                  const riga = (a.PrezzoUnitario ?? 0) * (a.Quantita ?? 0);
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td className="px-2 py-3 font-medium" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                        {a.Marca ?? "—"}
                      </td>
                      <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {a.Modello ?? "—"}
                      </td>
                      <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {a.Misura ?? "—"}
                      </td>
                      <td className="px-2 py-3 text-center" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {a.Quantita}
                      </td>
                      <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {euro(a.PrezzoUnitario)}
                      </td>
                      <td className="px-2 py-3 font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                        {a.PrezzoUnitario != null ? euro(riga) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Servizi ── */}
      {servizi.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Wrench size={16} style={{ color: "var(--text-muted)" }} />
            <h2 className="font-bold text-base" style={{ fontFamily: "var(--font-poppins)" }}>Servizi</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Descrizione", "Qtà", "Prezzo", "Totale"].map((h) => (
                    <th key={h} className="text-left pb-3 px-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {servizi.map((s, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="px-2 py-3 font-medium" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                      {s.titolo}
                    </td>
                    <td className="px-2 py-3 text-center" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                      {s.quantita}
                    </td>
                    <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                      {euro(s.prezzo)}
                    </td>
                    <td className="px-2 py-3 font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                      {euro(s.prezzo * s.quantita)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Note ── */}
      {note && (
        <Card padding="sm">
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
            Note
          </p>
          <p className="text-sm" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)", whiteSpace: "pre-wrap" }}>
            {note}
          </p>
        </Card>
      )}

      {/* ── Totali ── */}
      {(articoli.length > 0 || servizi.length > 0) && (
        <Card>
          <div className="flex justify-end">
            <div className="w-full max-w-xs space-y-1.5 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
              <div className="flex justify-between">
                <span style={{ color: "var(--text-secondary)" }}>Imponibile</span>
                <span style={{ color: "var(--text-primary)" }}>{euro(imponibile)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--text-secondary)" }}>IVA 22%</span>
                <span style={{ color: "var(--text-primary)" }}>{euro(iva)}</span>
              </div>
              <div
                className="flex justify-between pt-2 text-base font-bold"
                style={{ borderTop: "1px solid var(--border)", fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}
              >
                <span>Totale</span>
                <span>{euro(totale)}</span>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
