"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  doc, getDoc, collection, getDocs, query, orderBy,
  updateDoc, addDoc, serverTimestamp, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/layout/AuthProvider";
import {
  ChevronRight, ArrowLeft, Printer, Mail, XCircle, ExternalLink,
  Plus, Send, CheckCircle2, Package, Truck, Clock, RotateCcw,
} from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import toast from "react-hot-toast";
import type { Ordine, OrdineStato } from "@/lib/types";

type CronologiaEntry = {
  id: string;
  DataOra: Timestamp;
  Operatore: string;
  Azione: string;
  Nota?: string;
};

type NotaInterna = {
  id: string;
  DataCreazione: Timestamp;
  Testo: string;
  Operatore: string;
};

type ClienteInfo = {
  id: string;
  nome: string;
  email?: string;
  telefono?: string;
  partitaIVA?: string;
};

const statoVariant: Record<string, "success" | "brand" | "warning" | "error" | "neutral"> = {
  "Confermato":             "brand",
  "In lavorazione":         "warning",
  "Spedito":                "success",
  "Consegnato":             "success",
  "In attesa di pagamento": "neutral",
  "Annullato":              "error",
  "Rimborsato":             "error",
};

const fonteColors: Record<string, string> = {
  B2B:         "#FFC803",
  Amazon:      "#F9A825",
  eBay:        "#E53935",
  WooCommerce: "#9C27B0",
};

const statoIcons: Record<string, React.ElementType> = {
  "In attesa di pagamento": Clock,
  "Confermato":             CheckCircle2,
  "In lavorazione":         Package,
  "Spedito":                Truck,
  "Consegnato":             CheckCircle2,
  "Annullato":              XCircle,
  "Rimborsato":             RotateCcw,
};

const STATI: OrdineStato[] = [
  "In attesa di pagamento",
  "Confermato",
  "In lavorazione",
  "Spedito",
  "Consegnato",
  "Annullato",
  "Rimborsato",
];

function euro(n: number | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function fmtDt(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtData(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function normalizeArticolo(a: Record<string, unknown>) {
  return {
    titolo:    String(a.Titolo ?? a.titolo ?? "Prodotto"),
    marca:     String(a.Marca  ?? a.marca  ?? ""),
    qty:       Number(a.Quantita ?? a.quantita ?? 0),
    prezzo:    Number(a.PrezzoUnitario ?? a.prezzo ?? 0),
    pfu:       Number(a.PFU ?? a.pfu ?? 0),
    logistica: Number(a.contributoLogistico ?? 0),
    sku:       String(a.SKU ?? a.sku ?? a.Prodotto ?? ""),
  };
}

export default function OrdineAdminDetailPage() {
  const params  = useParams();
  const id      = params.id as string;
  const { user } = useAuth();

  const [ordine,      setOrdine]      = useState<Ordine | null>(null);
  const [cronologia,  setCronologia]  = useState<CronologiaEntry[]>([]);
  const [note,        setNote]        = useState<NotaInterna[]>([]);
  const [clienteInfo, setClienteInfo] = useState<ClienteInfo | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [nuovaNota,   setNuovaNota]   = useState("");
  const [tracking,    setTracking]    = useState("");
  const [savingStato,    setSavingStato]    = useState(false);
  const [savingNota,     setSavingNota]     = useState(false);
  const [savingTracking, setSavingTracking] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "Ordini", id));
        if (!snap.exists()) {
          toast.error("Ordine non trovato");
          return;
        }
        const o = { id: snap.id, ...snap.data() } as Ordine;
        setOrdine(o);
        setTracking(o.Tracking ?? "");

        const [cronSnap, noteSnap] = await Promise.all([
          getDocs(query(collection(db, "Ordini", id, "Cronologia"), orderBy("DataOra", "asc"))),
          getDocs(query(collection(db, "Ordini", id, "Note_Interne"), orderBy("DataCreazione", "desc"))),
        ]);
        setCronologia(cronSnap.docs.map((d) => ({ id: d.id, ...d.data() } as CronologiaEntry)));
        setNote(noteSnap.docs.map((d) => ({ id: d.id, ...d.data() } as NotaInterna)));

        const ref = o.Cliente ?? o.Utente;
        if (ref) {
          const cSnap = await getDoc(ref);
          if (cSnap.exists()) {
            const d = cSnap.data();
            const nome = o.Cliente
              ? (String(d.Azienda || "").trim() || `${d.Nome ?? ""} ${d.Cognome ?? ""}`.trim() || "—")
              : (String(d.displayName || d.email || "—"));
            setClienteInfo({
              id:          cSnap.id,
              nome,
              email:      String(d.Email ?? d.email ?? ""),
              telefono:   String(d.Telefono ?? ""),
              partitaIVA: String(d.PartitaIVA ?? ""),
            });
          }
        }
      } catch (e) {
        toast.error("Errore nel caricamento ordine");
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [id]);

  async function handleStatoChange(nuovoStato: OrdineStato) {
    if (!ordine || savingStato || nuovoStato === ordine.Stato) return;
    setSavingStato(true);
    try {
      await updateDoc(doc(db, "Ordini", id), {
        Stato: nuovoStato,
        DataAggiornamento: serverTimestamp(),
      });
      await addDoc(collection(db, "Ordini", id, "Cronologia"), {
        DataOra:   serverTimestamp(),
        Operatore: user?.displayName || user?.email || "Operatore",
        Azione:    `Stato → ${nuovoStato}`,
        Nota:      "",
      });
      setOrdine({ ...ordine, Stato: nuovoStato });
      const newCron = await getDocs(query(collection(db, "Ordini", id, "Cronologia"), orderBy("DataOra", "asc")));
      setCronologia(newCron.docs.map((d) => ({ id: d.id, ...d.data() } as CronologiaEntry)));
      toast.success(`Stato: ${nuovoStato}`);
    } catch {
      toast.error("Errore aggiornamento stato");
    } finally {
      setSavingStato(false);
    }
  }

  async function handleAddNota() {
    if (!nuovaNota.trim() || savingNota) return;
    setSavingNota(true);
    try {
      const ref = await addDoc(collection(db, "Ordini", id, "Note_Interne"), {
        DataCreazione: serverTimestamp(),
        Testo:     nuovaNota.trim(),
        Operatore: user?.displayName || user?.email || "Operatore",
      });
      setNote([{ id: ref.id, DataCreazione: Timestamp.now(), Testo: nuovaNota.trim(), Operatore: user?.displayName || "" }, ...note]);
      setNuovaNota("");
      toast.success("Nota salvata");
    } catch {
      toast.error("Errore salvataggio nota");
    } finally {
      setSavingNota(false);
    }
  }

  async function handleSaveTracking() {
    if (!ordine || savingTracking) return;
    setSavingTracking(true);
    try {
      await updateDoc(doc(db, "Ordini", id), { Tracking: tracking });
      setOrdine({ ...ordine, Tracking: tracking });
      toast.success("Tracking aggiornato");
    } catch {
      toast.error("Errore aggiornamento tracking");
    } finally {
      setSavingTracking(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-64 rounded-xl" style={{ background: "var(--bg-secondary)" }} />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-4">
            {[260, 200, 160].map((h, i) => (
              <div key={i} className="rounded-2xl" style={{ height: h, background: "var(--bg-secondary)", border: "1px solid var(--border)" }} />
            ))}
          </div>
          <div className="space-y-4">
            {[120, 120, 100].map((h, i) => (
              <div key={i} className="rounded-2xl" style={{ height: h, background: "var(--bg-secondary)", border: "1px solid var(--border)" }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!ordine) {
    return (
      <div className="text-center py-20" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
        <p className="text-sm">Ordine non trovato.</p>
        <Link href="/admin/ordini" className="text-sm font-semibold mt-3 inline-block" style={{ color: "var(--brand)" }}>
          ← Torna agli ordini
        </Link>
      </div>
    );
  }

  const articoli = (ordine.Articoli ?? []) as Record<string, unknown>[];
  const normalized = articoli.map(normalizeArticolo);
  const subtotale   = normalized.reduce((s, a) => s + a.prezzo  * a.qty, 0);
  const pfuTotale   = normalized.reduce((s, a) => s + a.pfu     * a.qty, 0);
  const logTotale   = normalized.reduce((s, a) => s + a.logistica * a.qty, 0);
  const baseImpon   = subtotale + pfuTotale + logTotale;
  const ivaCalc     = baseImpon * 0.22;
  const totaleCalc  = baseImpon + ivaCalc;

  const inFat = ordine.IndirizzoFatturazione;
  const inSpe = ordine.IndirizzoSpedizione;

  return (
    <div className="space-y-6">
      {/* Breadcrumb + header */}
      <div>
        <nav className="flex items-center gap-1.5 text-xs mb-3" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
          <Link href="/admin/ordini" className="hover:underline flex items-center gap-1">
            <ArrowLeft size={11} /> Ordini
          </Link>
          <ChevronRight size={12} />
          <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
            {ordine.Numero ?? `#${id.slice(0, 8).toUpperCase()}`}
          </span>
        </nav>

        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
            {ordine.Numero ?? `Ordine #${id.slice(0, 8).toUpperCase()}`}
          </h1>
          <span className="px-2.5 py-1 rounded-full text-xs font-bold text-white" style={{ background: fonteColors[ordine.Source] ?? "#666" }}>
            {ordine.Source}
          </span>
          <Badge variant={statoVariant[ordine.Stato] ?? "neutral"}>{ordine.Stato}</Badge>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>Cambia stato:</span>
            <select
              value={ordine.Stato}
              onChange={(e) => handleStatoChange(e.target.value as OrdineStato)}
              disabled={savingStato}
              className="px-3 py-2 rounded-xl text-sm outline-none font-medium"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
            >
              {STATI.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
          Creato il {fmtData(ordine.DataCreazione)}
          {ordine.eBay_OrderID && ` · eBay ID: ${ordine.eBay_OrderID}`}
          {ordine.Amazon_MarketplaceID && ` · Amazon: ${ordine.Amazon_MarketplaceID}`}
          {ordine.WC_OrderNumber && ` · WC: #${ordine.WC_OrderNumber}`}
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* LEFT COLUMN */}
        <div className="xl:col-span-2 space-y-5">

          {/* Articoli */}
          <Card padding="md">
            <h2 className="text-base font-bold mb-4" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
              Articoli ({normalized.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                <thead>
                  <tr className="text-left" style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Prodotto", "Qtà", "Prezzo", "PFU", "Contrib.Log.", "Totale"].map((h) => (
                      <th key={h} className="pb-3 pr-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {normalized.map((a, i) => (
                    <tr key={i} className="hover:bg-[#F9FAFB] transition-colors" style={{ borderBottom: "1px solid var(--border)" }}>
                      <td className="py-3.5 pr-3">
                        <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{a.marca && `${a.marca} `}{a.titolo}</p>
                        {a.sku && <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{a.sku}</p>}
                      </td>
                      <td className="py-3.5 pr-3" style={{ color: "var(--text-secondary)" }}>{a.qty}</td>
                      <td className="py-3.5 pr-3" style={{ color: "var(--text-primary)" }}>{euro(a.prezzo)}</td>
                      <td className="py-3.5 pr-3" style={{ color: "var(--text-muted)" }}>{euro(a.pfu)}</td>
                      <td className="py-3.5 pr-3" style={{ color: "var(--text-muted)" }}>{euro(a.logistica)}</td>
                      <td className="py-3.5 font-bold" style={{ color: "var(--text-primary)" }}>
                        {euro((a.prezzo + a.pfu + a.logistica) * a.qty)}
                      </td>
                    </tr>
                  ))}
                  {normalized.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                        Nessun articolo
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {normalized.length > 0 && (
              <div className="mt-4 pt-4 space-y-1.5 text-sm" style={{ borderTop: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }}>
                {[
                  { label: "Subtotale",          val: subtotale },
                  { label: "PFU",                 val: pfuTotale },
                  { label: "Contrib. Logistico",  val: logTotale },
                  { label: "IVA 22%",             val: ordine.IVA ?? ivaCalc },
                ].map(({ label, val }) => (
                  <div key={label} className="flex justify-end gap-16">
                    <span style={{ color: "var(--text-secondary)" }}>{label}</span>
                    <span className="w-24 text-right" style={{ color: "var(--text-primary)" }}>{euro(val)}</span>
                  </div>
                ))}
                <div className="flex justify-end gap-16 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                  <span className="font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>Totale</span>
                  <span className="w-24 text-right text-lg font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                    {euro(ordine.Totale ?? totaleCalc)}
                  </span>
                </div>
              </div>
            )}
          </Card>

          {/* Cronologia */}
          <Card padding="md">
            <h2 className="text-base font-bold mb-5" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
              Cronologia
            </h2>
            {cronologia.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                Nessuna cronologia disponibile
              </p>
            ) : (
              <div className="relative pl-5">
                <div className="absolute left-[7px] top-2 bottom-2 w-px" style={{ background: "var(--border)" }} />
                <div className="space-y-5">
                  {cronologia.map((c) => {
                    const Icon = statoIcons[c.Azione?.split("→")[1]?.trim() ?? ""] ?? CheckCircle2;
                    return (
                      <div key={c.id} className="relative flex gap-4">
                        <div
                          className="absolute -left-5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center"
                          style={{ background: "#fff", borderColor: "var(--brand)", top: "2px" }}
                        />
                        <div className="flex-1 pb-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-semibold" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                              {c.Azione}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                            <span>{fmtDt(c.DataOra)}</span>
                            {c.Operatore && <span>· {c.Operatore}</span>}
                          </div>
                          {c.Nota && (
                            <p className="text-xs mt-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>{c.Nota}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>

          {/* Note interne */}
          <Card padding="md">
            <h2 className="text-base font-bold mb-4" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
              Note interne
            </h2>
            <div className="flex gap-2 mb-4">
              <textarea
                rows={2}
                value={nuovaNota}
                onChange={(e) => setNuovaNota(e.target.value)}
                placeholder="Aggiungi una nota interna…"
                className="flex-1 rounded-xl px-3 py-2.5 text-sm resize-none outline-none"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
              />
              <button
                onClick={handleAddNota}
                disabled={savingNota || !nuovaNota.trim()}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold self-start disabled:opacity-40"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                <Send size={14} />
                {savingNota ? "…" : "Invia"}
              </button>
            </div>

            <div className="space-y-3">
              {note.map((n) => (
                <div key={n.id} className="rounded-xl p-3" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>{n.Operatore}</span>
                    <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>{fmtDt(n.DataCreazione)}</span>
                  </div>
                  <p className="text-sm" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>{n.Testo}</p>
                </div>
              ))}
              {note.length === 0 && (
                <p className="text-xs text-center py-2" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  Nessuna nota ancora
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* RIGHT SIDEBAR */}
        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">

          {/* Cliente */}
          <Card padding="sm">
            <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              Cliente
            </h2>
            {clienteInfo ? (
              <div className="space-y-1 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{clienteInfo.nome}</p>
                {clienteInfo.email    && <p style={{ color: "var(--text-secondary)" }}>{clienteInfo.email}</p>}
                {clienteInfo.telefono && <p style={{ color: "var(--text-secondary)" }}>{clienteInfo.telefono}</p>}
                {clienteInfo.partitaIVA && <p className="text-xs" style={{ color: "var(--text-muted)" }}>P.IVA {clienteInfo.partitaIVA}</p>}
                {ordine.Cliente && (
                  <Link
                    href={`/admin/clienti/${clienteInfo.id}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold mt-2"
                    style={{ color: "#2563EB" }}
                  >
                    Scheda cliente <ExternalLink size={11} />
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>—</p>
            )}
          </Card>

          {/* Indirizzi */}
          {inFat && (
            <Card padding="sm">
              <h2 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                Indirizzo fatturazione
              </h2>
              <div className="text-sm space-y-0.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
                {inFat.Azienda && <p className="font-semibold">{inFat.Azienda}</p>}
                {inFat.PartitaIVA && <p className="text-xs" style={{ color: "var(--text-muted)" }}>P.IVA {inFat.PartitaIVA}</p>}
                <p>{inFat.Via} {inFat.Civico}</p>
                <p>{inFat.CAP} {inFat.Citta} ({inFat.Provincia})</p>
              </div>
            </Card>
          )}

          {inSpe && (
            <Card padding="sm">
              <h2 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                Indirizzo spedizione
              </h2>
              <div className="text-sm space-y-0.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
                <p>{inSpe.Via} {inSpe.Civico}</p>
                <p>{inSpe.CAP} {inSpe.Citta} ({inSpe.Provincia})</p>
              </div>
            </Card>
          )}

          {/* Pagamento */}
          {ordine.Pagamento && (
            <Card padding="sm">
              <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                Pagamento
              </h2>
              <div className="space-y-2 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                <div className="flex justify-between">
                  <span style={{ color: "var(--text-muted)" }}>Metodo</span>
                  <span style={{ color: "var(--text-primary)" }}>{ordine.Pagamento.Metodo || "—"}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span style={{ color: "var(--text-muted)" }}>Stato</span>
                  <Badge variant={ordine.Pagamento.Stato === "Pagato" ? "success" : "neutral"}>
                    {ordine.Pagamento.Stato || "—"}
                  </Badge>
                </div>
                {ordine.Pagamento.Riferimento && (
                  <div className="flex justify-between">
                    <span style={{ color: "var(--text-muted)" }}>Riferimento</span>
                    <span className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>{ordine.Pagamento.Riferimento}</span>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Tracking */}
          <Card padding="sm">
            <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              Spedizione
            </h2>
            <div className="space-y-3 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Tracking number</p>
              <div className="flex gap-2">
                <input
                  value={tracking}
                  onChange={(e) => setTracking(e.target.value)}
                  placeholder="Inserisci tracking…"
                  className="flex-1 px-3 py-2 rounded-xl text-xs outline-none font-mono"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
                <button
                  onClick={handleSaveTracking}
                  disabled={savingTracking}
                  className="px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-40"
                  style={{ background: "var(--brand)", color: "#111" }}
                >
                  {savingTracking ? "…" : "Salva"}
                </button>
              </div>
            </div>
          </Card>

          {/* Azioni */}
          <Card padding="sm">
            <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              Azioni
            </h2>
            <div className="space-y-2">
              <Link
                href={`/admin/ordini/${id}/stampa`}
                target="_blank"
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors hover:bg-[#F1F4F8]"
                style={{ border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-montserrat)", background: "#fff" }}
              >
                <Printer size={15} /> Stampa ordine PDF
              </Link>
              <button
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors hover:bg-[#F1F4F8]"
                style={{ border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-montserrat)", background: "#fff" }}
              >
                <Mail size={15} /> Invia email conferma
              </button>
              <button
                onClick={() => handleStatoChange("Annullato")}
                disabled={ordine.Stato === "Annullato" || savingStato}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40"
                style={{ background: "#FEE2E2", color: "#991B1B", fontFamily: "var(--font-montserrat)", border: "1px solid #FECACA" }}
              >
                <XCircle size={15} /> Annulla ordine
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
