"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@/components/layout/AuthProvider";
import Link from "next/link";
import { Eye, RotateCcw, Search, ShoppingBag, Users } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";
import type { Ordine, OrdineStato } from "@/lib/types";
import type { OrdineListItemApi } from "@/lib/ordiniDb";

// Ordini propri: da Postgres (core.ordini, via lib/ordiniDb.ts — API canonica).
// Ordini del rappresentante: ANCORA da Firestore via /api/rappresentante/ordini
// (Fase 1.4, non ancora fatta) — shape diversa, arricchita server-side con
// l'identità del cliente a cui appartengono, per il filtro dedicato sotto.
type OrdineRappresentante = Omit<Ordine, "DataCreazione"> & {
  _repClienteUid?: string | null;
  _repClienteNome?: string | null;
  DataCreazione?: { seconds: number } | number | null;
  DataOra?: { seconds: number } | number | null;
};

// Forma unica su cui gira tutta la UI sotto — un piccolo adattatore per
// ciascuna delle due fonti la produce subito dopo il fetch.
type OrdineRow = {
  id: string;
  Numero: string | null;
  Stato: string;
  Totale: number;
  articoliCount: number;
  dataDisplay: string | number | { seconds: number } | null | undefined;
  repClienteUid?: string | null;
  repClienteNome?: string | null;
};

function fromApi(o: OrdineListItemApi): OrdineRow {
  return {
    id: o.id, Numero: o.Numero, Stato: o.Stato, Totale: o.Totale,
    articoliCount: o.ArticoliCount, dataDisplay: o.Data,
  };
}

function fromRappresentante(o: OrdineRappresentante): OrdineRow {
  return {
    id: o.id, Numero: o.Numero ?? null, Stato: o.Stato, Totale: o.Totale ?? 0,
    articoliCount: o.Articoli?.length ?? 0,
    dataDisplay: o.DataCreazione ?? o.DataOra,
    repClienteUid: o._repClienteUid, repClienteNome: o._repClienteNome,
  };
}

const statoVariant: Record<string, "success" | "brand" | "neutral" | "error"> = {
  "In Lavorazione":     "brand",
  "In Preparazione":    "brand",
  "Spedito":            "brand",
  "Consegnato":         "success",
  "Annullato":          "error",
  "Out of Stock":       "neutral",
  "Cancellato Tyre24":  "neutral",
  "Cancellato Cliente": "neutral",
};

function formatEuro(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function formatData(v: string | number | { seconds: number } | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v)
    : typeof v === "number" ? new Date(v)
    : new Date(v.seconds * 1000);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("it-IT");
}

export default function OrdiniPage() {
  const { user, loading: authLoading } = useAuth();
  const isRappresentante = user?.Ruolo === "Rappresentante";
  const [ordini, setOrdini] = useState<OrdineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statoFiltro, setStatoFiltro] = useState<OrdineStato | "">("");
  // Solo per Rappresentanti: elenco dei propri clienti (per il filtro) + selezione corrente.
  const [miClienti, setMiClienti] = useState<Array<{ uid: string; nome: string }>>([]);
  const [clienteFiltro, setClienteFiltro] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user?.uid) { setLoading(false); return; }

    const fetchOrdini = async () => {
      setLoading(true);
      try {
        if (isRappresentante) {
          // Ordini di TUTTI i propri clienti (non solo quelli piazzati in
          // prima persona) — vedi commento nella route sul modello dati.
          const res = await fetch("/api/rappresentante/ordini");
          const data = (await res.json().catch(() => ({}))) as {
            ordini?: OrdineRappresentante[];
            clienti?: Array<{ uid: string; nome: string }>;
            error?: string;
          };
          if (!res.ok) throw new Error(data.error ?? "Errore nel caricamento");
          setOrdini((data.ordini ?? []).map(fromRappresentante));
          setMiClienti(data.clienti ?? []);
          return;
        }

        const res = await fetch("/api/ordini");
        const data = (await res.json().catch(() => ({}))) as { ordini?: OrdineListItemApi[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Errore nel caricamento");
        // core.ordini è già ordinato per data desc lato route.
        setOrdini((data.ordini ?? []).map(fromApi));
      } catch (e) {
        toast.error("Errore nel caricamento ordini");
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetchOrdini();
  }, [user?.uid, authLoading, isRappresentante]);

  const filtered = ordini.filter((o) => {
    const matchSearch = !search || (o.Numero ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStato = !statoFiltro || o.Stato === statoFiltro;
    const matchCliente = !clienteFiltro || o.repClienteUid === clienteFiltro;
    return matchSearch && matchStato && matchCliente;
  });

  const totaleFiltered = filtered.reduce((s, o) => s + (o.Totale ?? 0), 0);

  return (
    <div className="space-y-6 px-4 sm:px-6 py-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
          {isRappresentante ? "Ordini dei miei clienti" : "I miei ordini"}
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
          {loading ? "Caricamento…" : `${filtered.length} ordini · Totale ${formatEuro(totaleFiltered)}`}
        </p>
      </div>

      {/* Filtri */}
      <Card padding="sm">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[180px] relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per numero ordine…"
              className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
            />
          </div>
          {isRappresentante && (
            <div className="relative">
              <Users size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
              <select
                value={clienteFiltro}
                onChange={(e) => setClienteFiltro(e.target.value)}
                className="pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none appearance-none"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
              >
                <option value="">Tutti i clienti</option>
                {miClienti.map((c) => (
                  <option key={c.uid} value={c.uid}>{c.nome}</option>
                ))}
              </select>
            </div>
          )}
          <select
            value={statoFiltro}
            onChange={(e) => setStatoFiltro(e.target.value as OrdineStato | "")}
            className="px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
          >
            <option value="">Tutti gli stati</option>
            <option value="In Lavorazione">In Lavorazione</option>
            <option value="In Preparazione">In Preparazione</option>
            <option value="Spedito">Spedito</option>
            <option value="Consegnato">Consegnato</option>
            <option value="Annullato">Annullato</option>
            <option value="Out of Stock">Out of Stock</option>
          </select>
          <button
            onClick={() => { setSearch(""); setStatoFiltro(""); setClienteFiltro(""); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
          >
            <RotateCcw size={14} /> Reset
          </button>
        </div>
      </Card>

      {/* Lista */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl animate-pulse"
              style={{ background: "var(--bg-primary)", height: 72, border: "1px solid var(--border)" }}
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <ShoppingBag size={48} style={{ color: "var(--text-muted)" }} />
          <p className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
            {ordini.length === 0 ? "Nessun ordine effettuato." : "Nessun ordine per i filtri selezionati."}
          </p>
          {ordini.length === 0 && (
            <Link
              href="/"
              className="px-5 py-2.5 rounded-full text-sm font-bold"
              style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-poppins)" }}
            >
              Vai al catalogo
            </Link>
          )}
        </div>
      ) : (
        <Card padding="none">
          <div
            className={`hidden sm:grid gap-4 px-5 py-3 text-xs font-bold uppercase tracking-widest ${isRappresentante ? "grid-cols-[1fr_1.3fr_1fr_1fr_1.5fr_auto]" : "grid-cols-[1fr_1fr_1fr_1.5fr_auto]"}`}
            style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)", borderBottom: "1px solid var(--border)" }}
          >
            <span>Ordine</span>
            {isRappresentante && <span>Cliente</span>}
            <span>Data</span>
            <span>Stato</span>
            <span>Totale</span>
            <span />
          </div>
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {filtered.map((o) => (
              <div
                key={o.id}
                className={`grid grid-cols-1 gap-3 sm:gap-4 items-start sm:items-center px-5 py-4 hover:bg-[#F1F4F8] transition-colors ${isRappresentante ? "sm:grid-cols-[1fr_1.3fr_1fr_1fr_1.5fr_auto]" : "sm:grid-cols-[1fr_1fr_1fr_1.5fr_auto]"}`}
              >
                <div>
                  <span
                    className="text-sm font-bold px-2.5 py-1 rounded-lg inline-block"
                    style={{ background: "var(--bg-primary)", fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}
                  >
                    {o.Numero ?? `#${o.id.slice(0, 8).toUpperCase()}`}
                  </span>
                </div>
                {isRappresentante && (
                  <span className="text-sm truncate" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                    {o.repClienteNome ?? "—"}
                  </span>
                )}
                <span className="text-sm" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                  {formatData(o.dataDisplay)}
                </span>
                <Badge variant={statoVariant[o.Stato] ?? "neutral"}>{o.Stato}</Badge>
                <div>
                  <p className="text-sm font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
                    {formatEuro(o.Totale ?? 0)}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {o.articoliCount} {o.articoliCount === 1 ? "articolo" : "articoli"}
                  </p>
                </div>
                <Link
                  href={`/ordini/${o.id}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold w-fit"
                  style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-poppins)" }}
                >
                  <Eye size={13} /> Visualizza
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
