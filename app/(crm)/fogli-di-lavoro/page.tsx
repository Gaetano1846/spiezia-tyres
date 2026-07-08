"use client";

import { useState, useEffect, useRef } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Search, Plus, Eye, Wrench, X, FileDown, Clock, ChevronDown, Pencil, Printer, Car, User } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import toast from "react-hot-toast";
import type { FoglioApi } from "@/lib/fogliDb";

const statoVariant: Record<string, "brand" | "success" | "neutral"> = {
  Aperto:           "neutral",
  "In lavorazione": "brand",
  Completato:       "success",
};

type OperatoreOption = { uid: string; nome: string };
type ClienteOption = { id: string; nome: string; telefono?: string };

function formatOrario(foglio: FoglioApi): string {
  const iso = foglio.DataOra ?? foglio.DataCreazione;
  if (!iso) return "—";
  const d = new Date(iso);
  const day  = d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  return `${day}  ${time}`;
}

export default function FogliDiLavoroPage() {
  const [fogli, setFogli]             = useState<FoglioApi[]>([]);
  const [loading, setLoading]         = useState(true);
  const [operatori, setOperatori]     = useState<OperatoreOption[]>([]);

  // filtri
  const [clienteSearch, setClienteSearch]     = useState("");
  const [clienteSelezionato, setClienteSelezionato] = useState<{ id: string; nome: string } | null>(null);
  const [clientiSuggeriti, setClientiSuggeriti] = useState<ClienteOption[]>([]);
  const [showDropdown, setShowDropdown]       = useState(false);
  const [operatoreSelezionato, setOperatoreSelezionato] = useState("");
  const searchRef = useRef<HTMLDivElement>(null);

  // Chiude il dropdown clienti cliccando fuori
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Carica operatori (utenti CRM, ancora su Firestore) e tutti i fogli (Postgres)
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const [usersSnap, res] = await Promise.all([
          getDocs(collection(db, "users")),
          fetch("/api/fogli-di-lavoro"),
        ]);

        const ops: OperatoreOption[] = usersSnap.docs
          .filter((d) => d.data().CRM === true || d.data().Ruolo === "Admin")
          .map((d) => ({
            uid:  d.id,
            nome: (d.data().displayName as string) || (d.data().email as string) || d.id,
          }))
          .sort((a, b) => a.nome.localeCompare(b.nome));
        setOperatori(ops);

        if (!res.ok) throw new Error(String(res.status));
        const { fogli: list } = await res.json();
        setFogli(list);
      } catch (e) {
        toast.error("Errore nel caricamento fogli di lavoro");
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // Ricerca clienti live (server-side, Postgres)
  useEffect(() => {
    if (clienteSearch.trim().length < 1) {
      setClientiSuggeriti([]);
      setShowDropdown(false);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/clienti?q=${encodeURIComponent(clienteSearch.trim())}&limit=8`)
        .then((r) => r.json())
        .then(({ clienti }) => {
          const risultati: ClienteOption[] = (clienti ?? []).map((c: Record<string, unknown>) => ({
            id: c.id as string,
            nome: (c.Azienda && c.Ragione_Sociale) ? (c.Ragione_Sociale as string) : ((c.Nome as string)?.trim() || (c.Ragione_Sociale as string) || "—"),
            telefono: c.Telefono as string | undefined,
          }));
          setClientiSuggeriti(risultati);
          setShowDropdown(risultati.length > 0);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [clienteSearch]);

  const filtered = fogli.filter((f) => {
    const matchCliente   = !clienteSelezionato || f.ClienteId === clienteSelezionato.id;
    const matchOperatore = !operatoreSelezionato || f.OperatoreId === operatoreSelezionato;
    return matchCliente && matchOperatore;
  });

  function reset() {
    setClienteSelezionato(null);
    setClienteSearch("");
    setOperatoreSelezionato("");
  }

  const hasFilters = !!(clienteSelezionato || operatoreSelezionato);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
            Fogli di lavoro
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "Caricamento…" : `${filtered.length} fogli`}
          </p>
        </div>
        <Link
          href="/fogli-di-lavoro/nuovo"
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl flex-shrink-0"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
        >
          <Plus size={16} />
          Nuovo foglio
        </Link>
      </div>

      <Card>
        {/* ── Filtri ── */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">

          {/* Selettore cliente */}
          <div ref={searchRef} className="relative flex-1 min-w-[220px]">
            {clienteSelezionato ? (
              <div
                className="flex items-center gap-2 px-4 py-2 rounded-xl cursor-pointer"
                style={{ border: "1px solid var(--brand)", background: "var(--bg-primary)", fontFamily: "var(--font-montserrat)" }}
              >
                <span className="flex-1 text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                  {clienteSelezionato.nome}
                </span>
                <button
                  onClick={() => { setClienteSelezionato(null); setClienteSearch(""); }}
                  style={{ color: "var(--text-muted)" }}
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
                <input
                  type="text"
                  value={clienteSearch}
                  onChange={(e) => setClienteSearch(e.target.value)}
                  onFocus={() => clientiSuggeriti.length > 0 && setShowDropdown(true)}
                  placeholder="Cerca cliente"
                  className="w-full pl-9 pr-8 py-2 rounded-xl text-sm"
                  style={{
                    background: "var(--bg-primary)",
                    border: "1px solid var(--border)",
                    fontFamily: "var(--font-montserrat)",
                    color: "var(--text-primary)",
                    outline: "none",
                  }}
                />
                {showDropdown && (
                  <div
                    className="absolute z-20 w-full mt-1 rounded-xl shadow-lg overflow-hidden"
                    style={{ background: "#fff", border: "1px solid var(--border)" }}
                  >
                    {clientiSuggeriti.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={() => {
                          setClienteSelezionato({ id: c.id, nome: c.nome });
                          setClienteSearch("");
                          setShowDropdown(false);
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-[#F1F4F8] transition-colors"
                        style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
                      >
                        {c.nome}
                        {c.telefono && (
                          <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                            {c.telefono}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Dropdown operatore */}
          <select
            value={operatoreSelezionato}
            onChange={(e) => setOperatoreSelezionato(e.target.value)}
            className="text-sm px-3 py-2 rounded-xl min-w-[200px]"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
          >
            <option value="">Seleziona operatore</option>
            {operatori.map((o) => (
              <option key={o.uid} value={o.uid}>{o.nome}</option>
            ))}
          </select>

          {hasFilters && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}
            >
              <X size={14} /> Azzera
            </button>
          )}
        </div>

        {/* ── Tabella ── */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: "var(--bg-primary)" }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-2 py-12 text-center text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
            <Wrench size={32} className="mx-auto mb-2 opacity-40" />
            <p>Nessun foglio trovato</p>
          </div>
        ) : (
          <>
            {/* Mobile: lista a card */}
            <div className="md:hidden space-y-2.5">
              {filtered.map((f) => {
                const num = f.Numero != null ? String(f.Numero) : f.id.slice(0, 6).toUpperCase();
                const operatoreNome = operatori.find((o) => o.uid === f.OperatoreId)?.nome ?? "—";
                return (
                  <div
                    key={f.id}
                    className="rounded-xl p-3.5"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="font-bold text-sm" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                        #{num}
                      </span>
                      <Badge variant={statoVariant[f.Stato] ?? "neutral"}>{f.Stato}</Badge>
                    </div>
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                      {f.ClienteNome}
                    </p>
                    <div className="mt-1.5 space-y-1 text-xs" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                      <div className="flex items-center gap-2">
                        <Car size={12} className="flex-shrink-0" style={{ color: "var(--text-muted)" }} />
                        <span className="truncate">{f.VeicoloTarga || "—"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <User size={12} className="flex-shrink-0" style={{ color: "var(--text-muted)" }} />
                        <span className="truncate">{operatoreNome}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock size={12} className="flex-shrink-0" style={{ color: "var(--text-muted)" }} />
                        <span className="truncate">{formatOrario(f)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <Link
                        href={`/fogli-di-lavoro/${f.id}`}
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg"
                        style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)", border: "1px solid var(--border)" }}
                      >
                        <Eye size={13} />
                        Apri
                      </Link>
                      <Link
                        href={`/fogli-di-lavoro/${f.id}/modifica`}
                        className="flex items-center justify-center px-3 py-2 rounded-lg"
                        style={{ color: "#111", fontFamily: "var(--font-montserrat)", border: "1px solid #FFC803" }}
                        aria-label="Modifica"
                      >
                        <Pencil size={14} />
                      </Link>
                      <Link
                        href={`/fogli-di-lavoro/${f.id}/stampa`}
                        target="_blank"
                        className="flex items-center justify-center px-3 py-2 rounded-lg"
                        style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)", border: "1px solid var(--border)" }}
                        aria-label="Stampa"
                      >
                        <Printer size={14} />
                      </Link>
                      {f.PdfUrl && (
                        <a
                          href={f.PdfUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-center px-3 py-2 rounded-lg"
                          style={{ color: "#249689", fontFamily: "var(--font-montserrat)", border: "1px solid #24968940" }}
                          aria-label="Scarica PDF"
                        >
                          <FileDown size={14} />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop: tabella */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["N.", "Cliente", "Veicolo", "Operatore", "Orario", "Stato", ""].map((h) => (
                      <th
                        key={h}
                        className="text-left pb-3 px-2 text-xs font-semibold uppercase tracking-wider"
                        style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => {
                    const num = f.Numero != null ? String(f.Numero) : f.id.slice(0, 6).toUpperCase();
                    const operatoreNome = operatori.find((o) => o.uid === f.OperatoreId)?.nome ?? "—";
                    return (
                      <tr
                        key={f.id}
                        className="hover:bg-[#F1F4F8] transition-colors"
                        style={{ borderBottom: "1px solid var(--border)" }}
                      >
                        <td className="px-2 py-3 font-bold" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                          {num}
                        </td>
                        <td className="px-2 py-3 font-medium" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                          {f.ClienteNome}
                        </td>
                        <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                          {f.VeicoloTarga || "—"}
                        </td>
                        <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                          {operatoreNome}
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            {formatOrario(f)}
                          </span>
                        </td>
                        <td className="px-2 py-3">
                          <Badge variant={statoVariant[f.Stato] ?? "neutral"}>{f.Stato}</Badge>
                        </td>
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/fogli-di-lavoro/${f.id}`}
                              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors hover:bg-[#F1F4F8]"
                              style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)", border: "1px solid var(--border)" }}
                            >
                              <Eye size={13} />
                              Apri
                            </Link>
                            <Link
                              href={`/fogli-di-lavoro/${f.id}/modifica`}
                              className="flex items-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-lg transition-colors hover:bg-[#FFF8DC]"
                              style={{ color: "#111", fontFamily: "var(--font-montserrat)", border: "1px solid #FFC803" }}
                            >
                              <Pencil size={13} />
                            </Link>
                            <Link
                              href={`/fogli-di-lavoro/${f.id}/stampa`}
                              target="_blank"
                              className="flex items-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-lg transition-colors hover:bg-[#F1F4F8]"
                              style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)", border: "1px solid var(--border)" }}
                            >
                              <Printer size={13} />
                            </Link>
                            {f.PdfUrl && (
                              <a
                                href={f.PdfUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-lg"
                                style={{ color: "#249689", fontFamily: "var(--font-montserrat)", border: "1px solid #24968940" }}
                              >
                                <FileDown size={13} />
                                PDF
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
