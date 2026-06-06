"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  doc, getDoc, updateDoc, addDoc, collection, serverTimestamp, Timestamp,
} from "firebase/firestore";
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

// ─── Normalised display type ────────────────────────────────────────────────

type ArticoloDisplay = {
  marca?: string;
  modello?: string;
  misura?: string;
  titolo?: string;
  quantita: number;
  prezzoUnitario?: number;
  pfu?: number;
  stagione?: string;
};

type ClienteInfo = { nome: string; codiceFiscale?: string; email?: string; telefono?: string };
type VeicoloInfo = { targa: string; marca?: string; modello?: string; anno?: number; km?: number };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function euro(n: number | undefined | null): string {
  if (n == null) return "—";
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function fmtTs(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normaliseArticoli(raw: any): ArticoloDisplay[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const misura =
      r.Misura ||
      r.misura ||
      (r.Larghezza && r.Diametro
        ? `${r.Larghezza}/${r.Altezza ?? ""}R${r.Diametro}`
        : undefined);

    const prezzoUnitario =
      r.PrezzoUnitario ?? r.Prezzo ?? r.prezzoUnitario ?? r.Prezzo_Unitario;

    return {
      marca:         r.Marca || r.marca || undefined,
      modello:       r.Modello || r.modello || r.Titolo || r.titolo || undefined,
      misura,
      titolo:        r.Titolo || r.titolo || undefined,
      quantita:      Number(r.Quantita ?? r.quantita ?? r.qta ?? 1),
      prezzoUnitario: prezzoUnitario != null ? Number(prezzoUnitario) : undefined,
      pfu:           r.PFU != null ? Number(r.PFU) : undefined,
      stagione:      r.Stagione || r.stagione || undefined,
    };
  });
}

// ─── Preventivo raw type (union of old Flutter + new Next.js fields) ──────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrevRaw = Record<string, any> & { id: string };

function getNumero(p: PrevRaw): string {
  if (p.Numero)           return p.Numero;
  if (p.ID != null)       return `#${p.ID}`;
  return `#${p.id.slice(0, 6).toUpperCase()}`;
}

function getStato(p: PrevRaw): "Accettato" | "In attesa" | "Bozza" | "Rifiutato" {
  if (p.Stato) return p.Stato as "Accettato" | "In attesa" | "Bozza" | "Rifiutato";
  return p.Accettato ? "Accettato" : "In attesa";
}

function getArticoli(p: PrevRaw): ArticoloDisplay[] {
  // Old Flutter: Pneumatici_Nuovi
  if (Array.isArray(p.Pneumatici_Nuovi) && p.Pneumatici_Nuovi.length > 0)
    return normaliseArticoli(p.Pneumatici_Nuovi);
  // New Next.js: Articoli
  if (Array.isArray(p.Articoli) && p.Articoli.length > 0)
    return normaliseArticoli(p.Articoli);
  return [];
}

function getServizi(p: PrevRaw): { titolo: string; prezzo: number; quantita: number }[] {
  if (!Array.isArray(p.Servizi)) return [];
  return p.Servizi.map((s: PrevRaw) => ({
    titolo:   s.Titolo || s.titolo || "Servizio",
    prezzo:   Number(s.Prezzo ?? s.prezzoUnitario ?? s.PrezzoUnitario ?? 0),
    quantita: Number(s.Quantita ?? s.quantita ?? 1),
  })).filter((s) => s.prezzo > 0 || s.titolo !== "Servizio");
}

function badgeVariant(stato: string): "success" | "warning" | "neutral" | "error" {
  if (stato === "Accettato") return "success";
  if (stato === "Bozza")    return "warning";
  if (stato === "Rifiutato") return "error";
  return "neutral";
}

// ─── Component ────────────────────────────────────────────────────────────────


export default function PreventivoDetailPage() {
  const params    = useParams();
  const router    = useRouter();
  const clienteId = params.clienteId as string;
  const id        = params.id as string;

  const [preventivo,  setPreventivo]  = useState<PrevRaw | null>(null);
  const [clienteInfo, setClienteInfo] = useState<ClienteInfo | null>(null);
  const [veicoloInfo, setVeicoloInfo] = useState<VeicoloInfo | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [converting,  setConverting]  = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "Clienti", clienteId, "Preventivo", id));
        if (!snap.exists()) { toast.error("Preventivo non trovato"); return; }
        const p = { id: snap.id, ...snap.data() } as PrevRaw;
        setPreventivo(p);

        const cSnap = await getDoc(doc(db, "Clienti", clienteId));
        if (cSnap.exists()) {
          const d = cSnap.data();
          setClienteInfo({
            nome:           (d.Azienda && d.Ragione_Sociale) ? String(d.Ragione_Sociale) : String(d.Nome ?? "").trim() || "—",
            codiceFiscale:  d.Codice_Fiscale ? String(d.Codice_Fiscale) : undefined,
            email:          d.Email ? String(d.Email) : undefined,
            telefono:       d.Telefono ? String(d.Telefono) : undefined,
          });
        }

        const veicoloRef = p.Veicolo;
        if (veicoloRef && typeof veicoloRef === "object" && "path" in veicoloRef) {
          const vSnap = await getDoc(veicoloRef);
          if (vSnap.exists()) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const vd = vSnap.data() as any;
            setVeicoloInfo({
              targa:   String(vd.Targa ?? ""),
              marca:   vd.Marca  ? String(vd.Marca)  : undefined,
              modello: vd.Modello ? String(vd.Modello) : undefined,
              anno:    Number(vd.Anno ?? 0) || undefined,
              km:      Number(vd.Km ?? 0)   || undefined,
            });
          }
        }
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
      await updateDoc(doc(db, "Clienti", clienteId, "Preventivo", id), {
        Accettato: true,
        Stato: "Accettato",
        Data_Accettazione: serverTimestamp(),
      });
      setPreventivo({ ...preventivo, Accettato: true, Stato: "Accettato" });
      toast.success("Preventivo segnato come accettato");
    } catch { toast.error("Errore aggiornamento"); }
    finally { setSaving(false); }
  }

  async function handleRifiuta() {
    if (!preventivo || saving) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "Clienti", clienteId, "Preventivo", id), {
        Accettato: false,
        Stato: "In attesa",
        Data_Accettazione: null,
      });
      setPreventivo({ ...preventivo, Accettato: false, Stato: "In attesa" });
      toast.success("Preventivo rimesso in attesa");
    } catch { toast.error("Errore aggiornamento"); }
    finally { setSaving(false); }
  }

  async function handleConvertToOrder() {
    if (!preventivo || converting) return;
    // Guardia anti-doppia-conversione: un preventivo già convertito non deve
    // generare un secondo ordine (evita duplicati con numeri diversi).
    if (preventivo.OrdineId || preventivo.Convertito) {
      toast.error("Questo preventivo è già stato convertito in ordine");
      return;
    }
    const round2 = (x: number) => Math.round(x * 100) / 100;
    setConverting(true);
    try {
      const arts = getArticoli(preventivo);
      const servs = getServizi(preventivo);

      // Coerente con il totale mostrato a schermo: l'imponibile include il PFU.
      const totArticoli = arts.reduce(
        (s, a) => s + ((a.prezzoUnitario ?? 0) + (a.pfu ?? 0)) * a.quantita,
        0
      );
      const totPfu = arts.reduce((s, a) => s + (a.pfu ?? 0) * a.quantita, 0);
      const totServizi = servs.reduce((s, sv) => s + sv.prezzo * sv.quantita, 0);
      const imponibile = totArticoli + totServizi;
      const iva = imponibile * 0.22;
      const totale = imponibile + iva; // lordo, coerente col modello Ordini B2B

      const articoliOrdine = arts.map((a) => ({
        Prodotto: a.misura ?? "",
        Titolo: a.modello ?? a.titolo ?? "",
        Marca: a.marca ?? "",
        Quantita: a.quantita,
        PrezzoUnitario: a.prezzoUnitario ?? 0,
        PFU: a.pfu ?? 0,
      }));

      const sedeId = (preventivo.Sede?.id ?? preventivo.Sede) ?? "main";
      const n = await nextCounter("Ordine", typeof sedeId === "string" ? sedeId : "main");
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
        Note: preventivo.Note ?? preventivo.note ?? null,
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
  const articoli = getArticoli(preventivo);
  const servizi  = getServizi(preventivo);
  const note     = preventivo.Note || preventivo.note || "";

  const totaleArticoli = articoli.reduce(
    (s, a) => s + ((a.prezzoUnitario ?? 0) + (a.pfu ?? 0)) * a.quantita,
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
              {(preventivo.Data || preventivo.DataScadenza)
                ? <span>Data: <strong>{preventivo.Data ?? fmtTs(preventivo.DataScadenza)}</strong></span>
                : <span>Creato il <strong>{fmtTs(preventivo.Data_Creazione ?? preventivo.DataCreazione)}</strong></span>
              }
              {preventivo.Data_Accettazione && (
                <span>Accettato il <strong>{fmtTs(preventivo.Data_Accettazione)}</strong></span>
              )}
              {preventivo.DataScadenza && (
                <span style={{ color: "#EF4444" }}>
                  Scadenza: <strong>{fmtTs(preventivo.DataScadenza)}</strong>
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
            {preventivo.PDF_URL && (
              <a
                href={preventivo.PDF_URL}
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
          {clienteInfo ? (
            <div className="space-y-1 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
              <p className="font-bold text-base" style={{ color: "var(--text-primary)" }}>{clienteInfo.nome}</p>
              {clienteInfo.codiceFiscale && (
                <p className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>{clienteInfo.codiceFiscale}</p>
              )}
              {clienteInfo.telefono && (
                <p style={{ color: "var(--text-secondary)" }}>{clienteInfo.telefono}</p>
              )}
              {clienteInfo.email && (
                <p style={{ color: "var(--text-muted)" }}>{clienteInfo.email}</p>
              )}
              <Link href={`/clienti/${clienteId}`} className="text-xs font-semibold mt-2 inline-block" style={{ color: "#2563EB" }}>
                Scheda cliente →
              </Link>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>—</p>
          )}
        </Card>

        <Card padding="sm">
          <div className="flex items-center gap-2 mb-3">
            <Car size={14} style={{ color: "var(--text-muted)" }} />
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              Veicolo
            </p>
          </div>
          {veicoloInfo ? (
            <div className="space-y-1 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
              <p className="text-xl font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)", letterSpacing: "0.05em" }}>
                {veicoloInfo.targa}
              </p>
              <p style={{ color: "var(--text-secondary)" }}>
                {[veicoloInfo.marca, veicoloInfo.modello, veicoloInfo.anno].filter(Boolean).join(" ")}
              </p>
              {veicoloInfo.km && (
                <p style={{ color: "var(--text-muted)" }}>{veicoloInfo.km.toLocaleString("it-IT")} km</p>
              )}
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
                  const riga = (a.prezzoUnitario ?? 0) * a.quantita;
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td className="px-2 py-3 font-medium" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                        {a.marca ?? "—"}
                      </td>
                      <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {a.modello ?? a.titolo ?? "—"}
                      </td>
                      <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {a.misura ?? "—"}
                      </td>
                      <td className="px-2 py-3 text-center" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {a.quantita}
                      </td>
                      <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {euro(a.prezzoUnitario)}
                      </td>
                      <td className="px-2 py-3 font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                        {a.prezzoUnitario != null ? euro(riga) : "—"}
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
