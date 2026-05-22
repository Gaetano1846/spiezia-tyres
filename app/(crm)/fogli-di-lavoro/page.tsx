"use client";

import { useState, useEffect, useRef } from "react";
import {
  collection, query, getDocs, getDoc, limit, orderBy,
  type DocumentReference, type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Search, Plus, Eye, Wrench, X, FileDown, Clock, ChevronDown, Pencil, Printer } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import toast from "react-hot-toast";
import type { FoglioDiLavoro, Cliente } from "@/lib/types";

const statoVariant: Record<string, "brand" | "success" | "neutral"> = {
  Aperto:           "neutral",
  "In lavorazione": "brand",
  Completato:       "success",
  "In attesa":      "neutral",
  "In corso":       "brand",
  Completata:       "success",
};

type FoglioEntry = {
  foglio:        FoglioDiLavoro;
  clienteNome:   string;
  clientePath:   string;
  sedeNome:      string;
  veicoloTag:    string;
  operatoreNome: string;
  operatorePath: string;
  statoCalc:     string;
};

type OperatoreOption = { uid: string; nome: string };

function nomeCliente(c: Record<string, unknown>): string {
  if (c.Azienda && c.Ragione_Sociale) return c.Ragione_Sociale as string;
  return (c.Nome as string)?.trim() || "—";
}

async function batchGetDocs(refs: DocumentReference[]): Promise<Map<string, Record<string, unknown>>> {
  if (refs.length === 0) return new Map();
  const unique = [...new Map(refs.map((r) => [r.path, r])).values()];
  const snaps  = await Promise.all(unique.map((r) => getDoc(r)));
  const map    = new Map<string, Record<string, unknown>>();
  snaps.forEach((s) => {
    if (s.exists()) map.set(s.ref.path, { id: s.id, ...s.data() } as Record<string, unknown>);
  });
  return map;
}

function statoFromFoglio(f: FoglioDiLavoro): string {
  if (f.Stato) return f.Stato;
  const d = f as Record<string, unknown>;
  if (d.Ora_Fine)   return "Completato";
  if (d.Ora_Inizio) return "In lavorazione";
  return "Aperto";
}

function formatTs(ts: Timestamp | null | undefined, mode: "date" | "time" = "date"): string {
  if (!ts?.toDate) return "—";
  const d = ts.toDate();
  if (mode === "time") return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function formatOrario(foglio: FoglioDiLavoro): string {
  const d     = foglio as Record<string, unknown>;
  const start = d.Ora_Inizio as Timestamp | null | undefined;
  const end   = d.Ora_Fine   as Timestamp | null | undefined;
  if (start) {
    const day   = formatTs(start, "date");
    const tFrom = formatTs(start, "time");
    const tTo   = end ? formatTs(end, "time") : null;
    return tTo ? `${day}  ${tFrom} — ${tTo}` : `${day}  ${tFrom}`;
  }
  const creazione = (d.DataOra ?? d.Data_Creazione ?? d.DataCreazione) as Timestamp | null | undefined;
  return formatTs(creazione);
}

export default function FogliDiLavoroPage() {
  const [entries, setEntries]         = useState<FoglioEntry[]>([]);
  const [loading, setLoading]         = useState(true);
  const [operatori, setOperatori]     = useState<OperatoreOption[]>([]);

  // filtri
  const [clienteSearch, setClienteSearch]     = useState("");
  const [clienteSelezionato, setClienteSelezionato] = useState<{ id: string; nome: string } | null>(null);
  const [clientiSuggeriti, setClientiSuggeriti] = useState<Cliente[]>([]);
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

  // Carica operatori (utenti CRM) e tutti i fogli
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        // Operatori: utenti con CRM = true
        const usersSnap = await getDocs(collection(db, "users"));
        const ops: OperatoreOption[] = usersSnap.docs
          .filter((d) => d.data().CRM === true || d.data().Ruolo === "Admin")
          .map((d) => ({
            uid:  d.id,
            nome: (d.data().displayName as string) || (d.data().email as string) || d.id,
          }))
          .sort((a, b) => a.nome.localeCompare(b.nome));
        setOperatori(ops);

        // Fogli di lavoro
        const q    = query(collection(db, "Foglio_di_Lavoro"), limit(300));
        const snap = await getDocs(q);
        const fogli = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as FoglioDiLavoro))
          .sort((a, b) => {
            const fa = a as Record<string, unknown>;
            const fb = b as Record<string, unknown>;
            const ta = ((fa.DataOra ?? fa.Data_Creazione ?? fa.DataCreazione) as Timestamp | null)?.seconds ?? 0;
            const tb = ((fb.DataOra ?? fb.Data_Creazione ?? fb.DataCreazione) as Timestamp | null)?.seconds ?? 0;
            return tb - ta;
          });

        const clienteRefs   = fogli.map((f) => f.Cliente).filter(Boolean) as DocumentReference[];
        const sedeRefs      = fogli.map((f) => f.Sede).filter(Boolean) as DocumentReference[];
        const veicoloRefs   = fogli.map((f) => f.Veicolo).filter(Boolean) as DocumentReference[];
        const operatoreRefs = fogli.map((f) => f.Operatore).filter(Boolean) as DocumentReference[];

        const [clientiMap, sediMap, veicoliMap, operatoriMap] = await Promise.all([
          batchGetDocs(clienteRefs),
          batchGetDocs(sedeRefs),
          batchGetDocs(veicoloRefs),
          batchGetDocs(operatoreRefs),
        ]);

        const resolved: FoglioEntry[] = fogli.map((foglio) => {
          const c = foglio.Cliente   ? clientiMap.get(foglio.Cliente.path)     : undefined;
          const s = foglio.Sede      ? sediMap.get(foglio.Sede.path)           : undefined;
          const v = foglio.Veicolo   ? veicoliMap.get(foglio.Veicolo.path)    : undefined;
          const o = foglio.Operatore ? operatoriMap.get(foglio.Operatore.path) : undefined;

          return {
            foglio,
            clienteNome:   c ? nomeCliente(c) : "—",
            clientePath:   foglio.Cliente?.path ?? "",
            sedeNome:      s ? (s.Nome as string) ?? "—" : "—",
            veicoloTag:    v ? (v.Targa as string) || (v.identificativo as string) || "—" : "—",
            operatoreNome: o ? (o.displayName as string) || (o.email as string) || "—" : "—",
            operatorePath: foglio.Operatore?.path ?? "",
            statoCalc:     statoFromFoglio(foglio),
          };
        });

        setEntries(resolved);
      } catch (e) {
        toast.error("Errore nel caricamento fogli di lavoro");
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // Ricerca clienti live nella collection Clienti
  useEffect(() => {
    if (clienteSearch.length < 1) {
      setClientiSuggeriti([]);
      setShowDropdown(false);
      return;
    }
    getDocs(query(collection(db, "Clienti"), orderBy("Nome"), limit(200))).then((snap) => {
      const term = clienteSearch.toLowerCase();
      const risultati = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Cliente))
        .filter((c) => {
          const nome = nomeCliente(c as unknown as Record<string, unknown>);
          return (
            nome.toLowerCase().includes(term) ||
            (c.Telefono ?? "").includes(term) ||
            (c.Email ?? "").toLowerCase().includes(term)
          );
        })
        .slice(0, 8);
      setClientiSuggeriti(risultati);
      setShowDropdown(risultati.length > 0);
    });
  }, [clienteSearch]);

  const filtered = entries.filter(({ clientePath, operatorePath }) => {
    const matchCliente   = !clienteSelezionato || clientePath === `Clienti/${clienteSelezionato.id}`;
    const matchOperatore = !operatoreSelezionato || operatorePath === `users/${operatoreSelezionato}`;
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
      <div className="flex items-center justify-between">
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
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl"
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
                          setClienteSelezionato({ id: c.id, nome: nomeCliente(c as unknown as Record<string, unknown>) });
                          setClienteSearch("");
                          setShowDropdown(false);
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-[#F1F4F8] transition-colors"
                        style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
                      >
                        {nomeCliente(c as unknown as Record<string, unknown>)}
                        {c.Telefono && (
                          <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                            {c.Telefono}
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
        ) : (
          <div className="overflow-x-auto">
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
                {filtered.map(({ foglio, clienteNome, veicoloTag, operatoreNome, statoCalc }) => {
                  const fd     = foglio as Record<string, unknown>;
                  const num    = fd.ID?.toString() ?? foglio.id.slice(0, 6).toUpperCase();
                  const pdfUrl = (fd.URL as string | undefined) ?? (foglio as Record<string, unknown>).PDF as string | undefined;
                  return (
                    <tr
                      key={foglio.id}
                      className="hover:bg-[#F1F4F8] transition-colors"
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <td className="px-2 py-3 font-bold" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                        {num}
                      </td>
                      <td className="px-2 py-3 font-medium" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                        {clienteNome}
                      </td>
                      <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {veicoloTag}
                      </td>
                      <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {operatoreNome}
                      </td>
                      <td className="px-2 py-3 whitespace-nowrap" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {formatOrario(foglio)}
                        </span>
                      </td>
                      <td className="px-2 py-3">
                        <Badge variant={statoVariant[statoCalc] ?? "neutral"}>{statoCalc}</Badge>
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/fogli-di-lavoro/${foglio.id}`}
                            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors hover:bg-[#F1F4F8]"
                            style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)", border: "1px solid var(--border)" }}
                          >
                            <Eye size={13} />
                            Apri
                          </Link>
                          <Link
                            href={`/fogli-di-lavoro/${foglio.id}/modifica`}
                            className="flex items-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-lg transition-colors hover:bg-[#FFF8DC]"
                            style={{ color: "#111", fontFamily: "var(--font-montserrat)", border: "1px solid #FFC803" }}
                          >
                            <Pencil size={13} />
                          </Link>
                          <Link
                            href={`/fogli-di-lavoro/${foglio.id}/stampa`}
                            target="_blank"
                            className="flex items-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-lg transition-colors hover:bg-[#F1F4F8]"
                            style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)", border: "1px solid var(--border)" }}
                          >
                            <Printer size={13} />
                          </Link>
                          {pdfUrl && (
                            <a
                              href={pdfUrl}
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

                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-12 text-center text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                      <Wrench size={32} className="mx-auto mb-2 opacity-40" />
                      <p>Nessun foglio trovato</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
