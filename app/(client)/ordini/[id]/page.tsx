"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  doc, getDoc, collection, getDocs, orderBy, query,
  Timestamp, type DocumentReference,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ShoppingBag, MapPin, CreditCard, Package, Truck, ChevronRight, CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";
import type { Ordine, ArticoloOrdine, Indirizzo } from "@/lib/types";

// ─── Types ─────────────────────────────────────────────────────────────────────

type CronologiaEntry = {
  id: string;
  Evento: string;
  Data: Timestamp;
  Operatore?: string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatEuro(n: number | undefined | null) {
  if (n == null) return "—";
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function formatData(ts: Timestamp | null | undefined): string {
  if (!ts) return "—";
  const d = ts instanceof Timestamp ? ts.toDate() : new Date((ts as { seconds: number }).seconds * 1000);
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDataOra(ts: Timestamp | null | undefined): string {
  if (!ts) return "—";
  const d = ts instanceof Timestamp ? ts.toDate() : new Date((ts as { seconds: number }).seconds * 1000);
  return d.toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── Stato badge ──────────────────────────────────────────────────────────────

const statoVariant: Record<string, "success" | "brand" | "warning" | "error" | "neutral"> = {
  "In attesa di pagamento": "neutral",
  "Confermato":             "brand",
  "In lavorazione":         "warning",
  "Spedito":                "brand",
  "Consegnato":             "success",
  "Annullato":              "error",
  "Rimborsato":             "error",
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

  const [ordine, setOrdine] = useState<Ordine | null>(null);
  const [cronologia, setCronologia] = useState<CronologiaEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;

    async function load() {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "Ordini", id));
        if (!snap.exists()) {
          setNotFound(true);
          return;
        }
        setOrdine({ id: snap.id, ...snap.data() } as Ordine);

        // Load cronologia (optional — may not exist)
        try {
          const cronSnap = await getDocs(
            query(collection(db, "Ordini", id, "Cronologia"), orderBy("Data", "asc")),
          );
          setCronologia(cronSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as CronologiaEntry));
        } catch {
          // Cronologia subcollection is optional; silently skip if missing
        }
      } catch {
        toast.error("Errore nel caricamento dell'ordine");
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [id]);

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
            {formatData(ordine.DataCreazione)}
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
          {ordine.Tracking && (
            <Card padding="md">
              <div className="flex items-center gap-2 mb-2">
                <Truck size={16} style={{ color: "var(--text-muted)" }} />
                <h2 className="text-sm font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                  Tracking
                </h2>
              </div>
              <p className="text-sm break-all" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
                {ordine.Tracking}
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
