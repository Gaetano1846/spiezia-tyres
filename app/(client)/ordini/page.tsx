"use client";
import { useState, useEffect } from "react";
import { collection, query, where, getDocs, doc } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/layout/AuthProvider";
import Link from "next/link";
import { Eye, RotateCcw, Search, ShoppingBag } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";
import type { Ordine, OrdineStato } from "@/lib/types";

const statoVariant: Record<string, "success" | "brand" | "neutral" | "error"> = {
  "Confermato":              "success",
  "Consegnato":              "success",
  "In lavorazione":          "brand",
  "Spedito":                 "brand",
  "In attesa di pagamento":  "neutral",
  "Annullato":               "error",
  "Rimborsato":              "error",
};

function formatEuro(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function formatData(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("it-IT");
}

export default function OrdiniPage() {
  const { user, loading: authLoading } = useAuth();
  const [ordini, setOrdini] = useState<Ordine[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statoFiltro, setStatoFiltro] = useState<OrdineStato | "">("");

  useEffect(() => {
    if (authLoading) return;
    if (!user?.uid) { setLoading(false); return; }

    const fetchOrdini = async () => {
      setLoading(true);
      try {
        const utenteRef = doc(db, "users", user.uid);
        const q = query(collection(db, "Ordini"), where("Utente", "==", utenteRef));
        const snap = await getDocs(q);
        const data = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Ordine))
          .sort((a, b) => {
            const ta = (a.DataCreazione as Timestamp)?.seconds ?? 0;
            const tb = (b.DataCreazione as Timestamp)?.seconds ?? 0;
            return tb - ta;
          });
        setOrdini(data);
      } catch (e) {
        toast.error("Errore nel caricamento ordini");
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetchOrdini();
  }, [user?.uid, authLoading]);

  const filtered = ordini.filter((o) => {
    const matchSearch = !search || (o.Numero ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStato = !statoFiltro || o.Stato === statoFiltro;
    return matchSearch && matchStato;
  });

  const totaleFiltered = filtered.reduce((s, o) => s + (o.Totale ?? 0), 0);

  return (
    <div className="space-y-6 px-4 sm:px-6 py-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
          I miei ordini
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
          <select
            value={statoFiltro}
            onChange={(e) => setStatoFiltro(e.target.value as OrdineStato | "")}
            className="px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
          >
            <option value="">Tutti gli stati</option>
            <option value="In attesa di pagamento">In attesa</option>
            <option value="Confermato">Confermato</option>
            <option value="In lavorazione">In lavorazione</option>
            <option value="Spedito">Spedito</option>
            <option value="Consegnato">Consegnato</option>
            <option value="Annullato">Annullato</option>
          </select>
          <button
            onClick={() => { setSearch(""); setStatoFiltro(""); }}
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
            className="hidden sm:grid grid-cols-[1fr_1fr_1fr_1.5fr_auto] gap-4 px-5 py-3 text-xs font-bold uppercase tracking-widest"
            style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)", borderBottom: "1px solid var(--border)" }}
          >
            <span>Ordine</span>
            <span>Data</span>
            <span>Stato</span>
            <span>Totale</span>
            <span />
          </div>
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {filtered.map((o) => (
              <div
                key={o.id}
                className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_1.5fr_auto] gap-3 sm:gap-4 items-start sm:items-center px-5 py-4 hover:bg-[#F1F4F8] transition-colors"
              >
                <div>
                  <span
                    className="text-sm font-bold px-2.5 py-1 rounded-lg inline-block"
                    style={{ background: "var(--bg-primary)", fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}
                  >
                    {o.Numero ?? `#${o.id.slice(0, 8).toUpperCase()}`}
                  </span>
                </div>
                <span className="text-sm" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                  {formatData(o.DataCreazione as Timestamp)}
                </span>
                <Badge variant={statoVariant[o.Stato] ?? "neutral"}>{o.Stato}</Badge>
                <div>
                  <p className="text-sm font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
                    {formatEuro(o.Totale ?? 0)}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {o.Articoli?.length ?? 0} {o.Articoli?.length === 1 ? "articolo" : "articoli"}
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
