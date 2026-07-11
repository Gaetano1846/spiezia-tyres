"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Timestamp } from "firebase/firestore";
import { useAuth } from "@/components/layout/AuthProvider";
import { ShoppingBag, MapPin, CreditCard, Package, Truck, ChevronRight, CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";
import type { Ordine, ArticoloOrdine, Indirizzo } from "@/lib/types";
import type { OrdineApi } from "@/lib/ordiniDb";

// ─── Types ─────────────────────────────────────────────────────────────────────

type CronologiaEntry = {
  id: string;
  Evento: string;
  Data: Timestamp | number | string | null;
  Operatore?: string;
};

// Pagina sola lettura (nessuna scrittura da qui) — a differenza del dettaglio
// admin, qui possiamo spostare SIA l'ordine SIA la Cronologia su Postgres
// senza rischio di lag di propagazione post-scrittura.
function apiToLocalOrdine(o: OrdineApi): Ordine {
  return {
    id: o.id,
    Numero: o.Numero ?? undefined,
    Source: o.Source,
    Stato: o.Stato,
    Articoli: o.Articoli.map((a) => ({
      Titolo: a.Titolo ?? "",
      Marca: a.Marca ?? "",
      Quantita: a.Quantita,
      PrezzoUnitario: a.PrezzoUnitario ?? 0,
      PFU: a.PFU ?? 0,
    })),
    Totale: o.Totale,
    IVA: o.IVA ?? 0,
    PFU: o.PFU ?? 0,
    SpeseExtra: Array.isArray(o.FsExtra?.SpeseExtra_array) ? o.FsExtra.SpeseExtra_array : [],
    ContributoLogistico: o.ContributoLogistico ?? undefined,
    Pagamento: o.Pagamento ?? undefined,
    IndirizzoFatturazione: o.IndirizzoFatturazione ?? undefined,
    IndirizzoSpedizione: o.IndirizzoSpedizione ?? undefined,
    Note: o.Note ?? undefined,
    DataCreazione: o.Data as unknown as Timestamp,
    GLS_TrackingNumber: o.GlsTrackingNumber ?? undefined,
  } as unknown as Ordine;
}

function apiToLocalCronologia(entries: OrdineApi["Cronologia"]): CronologiaEntry[] {
  return entries.map((c) => ({ id: c.id, Evento: c.Testo ?? "", Data: c.Ts, Operatore: c.Autore ?? undefined }));
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatEuro(n: number | undefined | null) {
  if (n == null) return "—";
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function tsToDate(ts: Timestamp | number | string | null | undefined): Date | null {
  if (!ts) return null;
  if (typeof ts === "string") { const d = new Date(ts); return Number.isNaN(d.getTime()) ? null : d; }
  if (typeof ts === "number") return new Date(ts);
  return ts instanceof Timestamp ? ts.toDate() : new Date((ts as { seconds: number }).seconds * 1000);
}

function formatData(ts: Timestamp | number | string | null | undefined): string {
  const d = tsToDate(ts);
  if (!d) return "—";
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDataOra(ts: Timestamp | number | string | null | undefined): string {
  const d = tsToDate(ts);
  if (!d) return "—";
  return d.toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── Stato badge ──────────────────────────────────────────────────────────────

const statoVariant: Record<string, "success" | "brand" | "warning" | "error" | "neutral"> = {
  "In Lavorazione":         "warning",
  "In Preparazione":        "warning",
  "Spedito":                "brand",
  "Consegnato":             "success",
  "Annullato":              "error",
  "Out of Stock":           "neutral",
  "Cancellato Tyre24":      "neutral",
  "Cancellato Cliente":     "neutral",
};

// ─── Skeletons ────────────────────────────────────────────────────────────────

function SkeletonBlock({ h = "h-4", w = "w-full" }: { h?: string; w?: string }) {
  return <div className={`${h} ${w} rounded animate-pulse`} style={{ background: "var(--bg-primary)" }} />;
}

function SkeletonPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <SkeletonBlock h="h-3" w="w-40" />
        <SkeletonBlock h="h-8" w="w-64" />
      </div>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 space-y-5">
          <div className="rounded-2xl p-6 animate-pulse" style={{ background: "#fff", border: "1px solid var(--border)" }}>
            <SkeletonBlock h="h-5" w="w-40" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonBlock key={i} h="h-10" />
              ))}
            </div>
          </div>
        </div>
        <div className="w-full lg:w-72 space-y-4">
          <div className="rounded-2xl p-6 animate-pulse" style={{ background: "#fff", border: "1px solid var(--border)" }}>
            <SkeletonBlock h="h-5" w="w-32" />
            <div className="mt-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonBlock key={i} h="h-4" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Indirizzo display ────────────────────────────────────────────────────────

function IndirizzoDisplay({ ind, title }: { ind: Indirizzo; title: string }) {
  return (
    <Card padding="md">
      <h2 className="text-sm font-bold mb-2" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
        {title}
      </h2>
      <div className="text-sm space-y-0.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
        {ind.Azienda && (
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{ind.Azienda}</p>
        )}
        <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
          {ind.Nome} {ind.Cognome}
        </p>
        <p>{ind.Via}{ind.Civico ? `, ${ind.Civico}` : ""}</p>
        <p>{ind.CAP} {ind.Citta} {ind.Provincia ? `(${ind.Provincia})` : ""}</p>
        {ind.Paese && <p>{ind.Paese}</p>}
        {ind.Telefono && <p>{ind.Telefono}</p>}
      </div>
    </Card>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function OrdinePage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";
  const { user, loading: authLoading } = useAuth();
  const isRappresentante = user?.Ruolo === "Rappresentante";

  const [ordine, setOrdine] = useState<Ordine | null>(null);
  const [cronologia, setCronologia] = useState<CronologiaEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id || authLoading) return;

    async function load() {
      setLoading(true);
      try {
        // Un rappresentante può visualizzare ordini piazzati DAI SUOI CLIENTI
        // (non solo i propri) — le Firestore Security Rules non riconoscono
        // quel legame, serve la route server-side (Admin SDK) dedicata.
        if (isRappresentante) {
          const res = await fetch(`/api/rappresentante/ordini/${id}`);
          const data = (await res.json().catch(() => ({}))) as { ordine?: Ordine; cronologia?: CronologiaEntry[]; error?: string };
          if (!res.ok || !data.ordine) {
            setNotFound(true);
            return;
          }
          setOrdine(data.ordine);
          setCronologia(data.cronologia ?? []);
          return;
        }

        // Ordine + Cronologia: da Postgres (core.ordini/b2b.ordini_cronologia,
        // già allineati in tempo reale dal bridge). Nessuna scrittura avviene
        // da questa pagina, quindi zero rischio di lag lettura-dopo-scrittura.
        const res = await fetch(`/api/ordini/${id}`);
        const data = (await res.json().catch(() => ({}))) as { ordine?: OrdineApi; error?: string };
        if (!res.ok || !data.ordine) {
          setNotFound(true);
          return;
        }
        setOrdine(apiToLocalOrdine(data.ordine));
        setCronologia(apiToLocalCronologia(data.ordine.Cronologia));
      } catch {
        toast.error("Errore nel caricamento dell'ordine");
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [id, authLoading, isRappresentante]);

  if (loading) return <SkeletonPage />;

  if (notFound || !ordine) {
    return (
      <div className="flex flex-col items-center py-20 gap-6">
        <Package size={56} style={{ color: "var(--text-muted)" }} />
        <div className="text-center">
          <p className="font-bold text-lg mb-1" style={{ fontFamily: "var(--font-poppins)" }}>
            Ordine non trovato
          </p>
          <p className="text-sm" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            L&apos;ordine che stai cercando non esiste o non sei autorizzato a visualizzarlo.
          </p>
        </div>
        <Link
          href="/account"
          className="px-6 py-2.5 rounded-full text-sm font-bold"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-poppins)" }}
        >
          Torna ai miei ordini
        </Link>
      </div>
    );
  }

  const articoli: ArticoloOrdine[] = ordine.Articoli ?? [];
  const numero = ordine.Numero ?? `#${id.slice(0, 8).toUpperCase()}`;

  // Compute subtotale from line items (Totale on the order already includes IVA)
  const subtotale = articoli.reduce((acc, a) => acc + a.PrezzoUnitario * a.Quantita, 0);
  const totalePfu = ordine.PFU ?? articoli.reduce((acc, a) => acc + a.PFU * a.Quantita, 0);
  const contributo = ordine.ContributoLogistico ?? 0;
  const iva = ordine.IVA ?? 0;
  const totale = ordine.Totale ?? 0;

  return (
    <div className="space-y-6 px-4 sm:px-6 py-6 max-w-5xl mx-auto">
      {/* Breadcrumb + header */}
      <div>
        <nav className="flex items-center gap-1.5 text-xs mb-3" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
          <Link href="/account" style={{ color: "var(--text-muted)" }}>I miei ordini</Link>
          <ChevronRight size={12} />
          <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{numero}</span>
        </nav>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
            Ordine {numero}
          </h1>
          <Badge variant={statoVariant[ordine.Stato] ?? "neutral"}>{ordine.Stato}</Badge>
          <span className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
            {/* DataCreazione = Next.js; DataOra = Flutter legacy */}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {formatData(((ordine as any).DataCreazione ?? (ordine as any).DataOra) as Timestamp)}
          </span>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* ── Left column ── */}
        <div className="flex-1 min-w-0 space-y-5">
          {/* Articoli */}
          <Card padding="md">
            <h2 className="text-base font-bold mb-4" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
              Articoli ordinati
            </h2>
            {articoli.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                Nessun articolo.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                  <thead>
                    <tr className="border-b text-left" style={{ borderColor: "var(--border)" }}>
                      {["Prodotto", "Qtà", "Prezzo unitario", "PFU", "Totale riga"].map((h) => (
                        <th
                          key={h}
                          className="pb-3 pr-4 text-xs font-semibold uppercase tracking-widest"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                    {articoli.map((a, i) => (
                      <tr key={i}>
                        <td className="py-3.5 pr-4">
                          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                            {a.Marca} {a.Titolo}
                          </p>
                        </td>
                        <td className="py-3.5 pr-4" style={{ color: "var(--text-secondary)" }}>
                          {a.Quantita}
                        </td>
                        <td className="py-3.5 pr-4" style={{ color: "var(--text-primary)" }}>
                          {formatEuro(a.PrezzoUnitario)}
                        </td>
                        <td className="py-3.5 pr-4" style={{ color: "var(--text-secondary)" }}>
                          {formatEuro(a.PFU)}
                        </td>
                        <td className="py-3.5 font-bold" style={{ color: "var(--text-primary)" }}>
                          {formatEuro(a.PrezzoUnitario * a.Quantita)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Note */}
          {ordine.Note && (
            <Card padding="md">
              <h2 className="text-base font-bold mb-3" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                Note
              </h2>
              <p className="text-sm" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
                {ordine.Note}
              </p>
            </Card>
          )}

          {/* Cronologia */}
          {cronologia.length > 0 && (
            <Card padding="md">
              <h2 className="text-base font-bold mb-4" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                Cronologia
              </h2>
              <div className="space-y-4">
                {cronologia.map((entry, i) => (
                  <div key={entry.id} className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0" style={{ color: "#10B981" }} />
                    <div>
                      <p className="text-sm font-semibold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                        {entry.Evento}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                        {formatDataOra(entry.Data)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* ── Right sidebar ── */}
        <div className="w-full lg:w-72 flex-shrink-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
          {/* Riepilogo importi */}
          <Card padding="md">
            <h2 className="text-base font-bold mb-4" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
              Riepilogo
            </h2>
            <div className="space-y-2 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
              <div className="flex justify-between">
                <span style={{ color: "var(--text-secondary)" }}>Subtotale</span>
                <span style={{ color: "var(--text-primary)" }}>{formatEuro(subtotale)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--text-secondary)" }}>PFU</span>
                <span style={{ color: "var(--text-primary)" }}>{formatEuro(totalePfu)}</span>
              </div>
              {contributo > 0 && (
                <div className="flex justify-between">
                  <span style={{ color: "var(--text-secondary)" }}>Contributo logistico</span>
                  <span style={{ color: "var(--text-primary)" }}>{formatEuro(contributo)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span style={{ color: "var(--text-secondary)" }}>IVA 22%</span>
                <span style={{ color: "var(--text-primary)" }}>{formatEuro(iva)}</span>
              </div>
              {ordine.SpeseExtra?.map((s, i) => (
                <div key={i} className="flex justify-between">
                  <span style={{ color: "var(--text-secondary)" }}>{s.Descrizione}</span>
                  <span style={{ color: "var(--text-primary)" }}>{formatEuro(s.Importo)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                <span className="font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>
                  Totale
                </span>
                <span className="text-lg font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>
                  {formatEuro(totale)}
                </span>
              </div>
            </div>
          </Card>

          {/* Pagamento */}
          {ordine.Pagamento && (
            <Card padding="md">
              <h2 className="text-sm font-bold mb-2" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                Metodo di pagamento
              </h2>
              <p className="text-sm" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
                {ordine.Pagamento.Metodo}
              </p>
              {ordine.Pagamento.Stato && (
                <p className="text-xs mt-1" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-muted)" }}>
                  Stato: {ordine.Pagamento.Stato}
                </p>
              )}
              {ordine.Pagamento.Riferimento && (
                <p className="text-xs mt-0.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-muted)" }}>
                  Rif: {ordine.Pagamento.Riferimento}
                </p>
              )}
            </Card>
          )}

          {/* Tracking */}
          {ordine.GLS_TrackingNumber && (
            <Card padding="md">
              <div className="flex items-center gap-2 mb-2">
                <Truck size={16} style={{ color: "var(--text-muted)" }} />
                <h2 className="text-sm font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                  Tracking
                </h2>
              </div>
              <p className="text-sm break-all" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
                {ordine.GLS_TrackingNumber}
              </p>
            </Card>
          )}

          {/* Indirizzo spedizione */}
          {ordine.IndirizzoSpedizione && (
            <IndirizzoDisplay ind={ordine.IndirizzoSpedizione} title="Indirizzo di spedizione" />
          )}

          {/* Indirizzo fatturazione */}
          {ordine.IndirizzoFatturazione && (
            <IndirizzoDisplay ind={ordine.IndirizzoFatturazione} title="Indirizzo di fatturazione" />
          )}
        </div>
      </div>
    </div>
  );
}
