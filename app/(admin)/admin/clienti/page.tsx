"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, orderBy, getDocs, limit, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Users, Search, Eye, Building2, CreditCard, X } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import toast from "react-hot-toast";
import type { Cliente } from "@/lib/types";

function formatEuro(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: 6 }).map((__, j) => (
            <td key={j} className="py-3.5 pr-4">
              <div className="h-4 rounded animate-pulse" style={{ background: "var(--border)", width: j === 0 ? "80%" : j === 5 ? "60px" : "70%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function ClientiPage() {
  const [clienti, setClienti] = useState<Cliente[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [soloFido, setSoloFido] = useState(false);

  useEffect(() => {
    async function fetchClienti() {
      try {
        const snap = await getDocs(
          query(collection(db, "Clienti"), orderBy("Nome"), limit(300))
        );
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Cliente));
        setClienti(docs);
      } catch (err) {
        console.error(err);
        toast.error("Errore nel caricamento dei clienti");
      } finally {
        setLoading(false);
      }
    }
    fetchClienti();
  }, []);

  // KPI counts — computed from loaded data
  const totalCount    = clienti.length;
  const fidoCount     = useMemo(() => clienti.filter((c) => (c.Fido ?? 0) > 0).length, [clienti]);
  const aziendaCount  = useMemo(() => clienti.filter((c) => !!c.Azienda).length, [clienti]);
  const pivaCount     = useMemo(() => clienti.filter((c) => !!c.Partita_Iva).length, [clienti]);

  const filtered = useMemo(() => {
    return clienti.filter((c) => {
      const ragione = (c.Azienda ? c.Ragione_Sociale : c.Nome) ?? "";
      const matchSearch =
        !search ||
        [ragione, c.Email ?? "", c.Telefono ?? "", c.Ragione_Sociale ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
      const matchFido = !soloFido || (c.Fido ?? 0) > 0;
      return matchSearch && matchFido;
    });
  }, [clienti, search, soloFido]);

  function reset() {
    setSearch("");
    setSoloFido(false);
  }

  const stats = [
    { label: "Totale clienti", value: totalCount, sub: "registrati",    icon: <Users size={22} />,     accent: "#FFC803" },
    { label: "Con fido",       value: fidoCount,  sub: "credito attivo", icon: <CreditCard size={22} />, accent: "#6366F1" },
    { label: "Con azienda",    value: aziendaCount, sub: "B2B",          icon: <Building2 size={22} />, accent: "#249689" },
    { label: "Con P.IVA",      value: pivaCount,  sub: "fatturazione",  icon: <CreditCard size={22} />, accent: "#EE8B60" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
            Clienti
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "Caricamento…" : `${filtered.length} clienti`}
          </p>
        </div>
        <button
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
        >
          + Aggiungi cliente
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      {/* Table card */}
      <Card padding="sm">
        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="flex-1 min-w-48 relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per nome, azienda, email…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none"
              style={{
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                fontFamily: "var(--font-montserrat)",
                color: "var(--text-primary)",
              }}
            />
          </div>

          <button
            onClick={() => setSoloFido((v) => !v)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
            style={{
              background: soloFido ? "#6366F120" : "var(--bg-primary)",
              border: soloFido ? "1px solid #6366F1" : "1px solid var(--border)",
              color: soloFido ? "#6366F1" : "var(--text-secondary)",
              fontFamily: "var(--font-montserrat)",
            }}
          >
            <CreditCard size={14} />
            Solo con fido
          </button>

          {(search || soloFido) && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium"
              style={{
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                fontFamily: "var(--font-montserrat)",
                color: "var(--text-secondary)",
              }}
            >
              <X size={14} /> Azzera
            </button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
            <thead>
              <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                {["Ragione Sociale", "Email", "Telefono", "Fido residuo", "P.IVA", ""].map((h) => (
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
              {loading ? (
                <SkeletonRows />
              ) : (
                <>
                  {filtered.map((c) => {
                    const ragione = (c.Azienda && c.Ragione_Sociale) ? c.Ragione_Sociale : c.Nome?.trim() || c.Ragione_Sociale || "—";
                    const fidoResiduo = c.Fido_Residuo ?? c.Fido;
                    return (
                      <tr
                        key={c.id}
                        className="hover:bg-[#F9FAFB] transition-colors"
                      >
                        <td className="py-3.5 pr-4 font-semibold" style={{ color: "var(--text-primary)" }}>
                          <div className="flex items-center gap-2">
                            {c.Azienda && (
                              <Building2 size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                            )}
                            {ragione}
                          </div>
                        </td>
                        <td className="py-3.5 pr-4" style={{ color: "var(--text-secondary)" }}>
                          {c.Email || <span style={{ color: "var(--text-muted)" }}>—</span>}
                        </td>
                        <td className="py-3.5 pr-4" style={{ color: "var(--text-secondary)" }}>
                          {c.Telefono || <span style={{ color: "var(--text-muted)" }}>—</span>}
                        </td>
                        <td className="py-3.5 pr-4">
                          {fidoResiduo != null && fidoResiduo > 0 ? (
                            <div className="flex items-baseline gap-1">
                              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                                {formatEuro(fidoResiduo)}
                              </span>
                              {c.Fido != null && c.Fido_Residuo != null && (
                                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                                  / {formatEuro(c.Fido)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: "var(--text-muted)" }}>—</span>
                          )}
                        </td>
                        <td className="py-3.5 pr-4" style={{ color: "var(--text-secondary)" }}>
                          {c.Partita_Iva || <span style={{ color: "var(--text-muted)" }}>—</span>}
                        </td>
                        <td className="py-3.5">
                          <Link
                            href={`/clienti/${c.id}`}
                            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap"
                            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
                          >
                            <Eye size={12} /> Visualizza
                          </Link>
                        </td>
                      </tr>
                    );
                  })}

                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                        Nessun cliente trovato.
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
