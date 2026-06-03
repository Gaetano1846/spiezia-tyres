"use client";

import { useState, useEffect } from "react";
import {
  collectionGroup, getDocs, getDoc, limit, query, doc,
  type DocumentReference, type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Search, Plus, Eye, FileText, X, Pencil } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import toast from "react-hot-toast";
import type { Preventivo } from "@/lib/types";

type StatoLabel = "Accettato" | "In attesa";

const statoVariant: Record<StatoLabel, "success" | "neutral"> = {
  Accettato: "success",
  "In attesa": "neutral",
};

function getStato(p: Preventivo): StatoLabel {
  return p.Accettato ? "Accettato" : "In attesa";
}

type PrevRow = {
  prev: Preventivo & { _clienteId: string };
  clienteNome: string;
  stato: StatoLabel;
};

async function batchGetDocs(refs: DocumentReference[]): Promise<Map<string, Record<string, unknown>>> {
  if (refs.length === 0) return new Map();
  const unique = [...new Map(refs.map((r) => [r.path, r])).values()];
  const snaps = await Promise.all(unique.map((r) => getDoc(r)));
  const map = new Map<string, Record<string, unknown>>();
  snaps.forEach((s) => {
    if (s.exists()) map.set(s.ref.path, { id: s.id, ...s.data() } as Record<string, unknown>);
  });
  return map;
}

function formatData(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function contaPezzi(prev: Preventivo): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = prev as any;
  const src = raw.Pneumatici_Nuovi?.length ? raw.Pneumatici_Nuovi : raw.Articoli ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tot = src.reduce((s: number, p: any) => s + (p.Quantita ?? p.quantita ?? p.qta ?? 0), 0);
  return tot > 0 ? `${tot} pz` : "—";
}


export default function PreventiviPage() {
  const [entries, setEntries] = useState<PrevRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [stato, setStato]     = useState<StatoLabel | "">("");

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const q = query(collectionGroup(db, "Preventivo"), limit(200));
        const snap = await getDocs(q);

        const prevs = snap.docs
          .map((d) => ({ id: d.id, _clienteId: d.ref.parent.parent?.id ?? "", ...d.data() } as Preventivo & { _clienteId: string }))
          .sort((a, b) => {
            const ta = (a.Data_Creazione as Timestamp)?.seconds ?? 0;
            const tb = (b.Data_Creazione as Timestamp)?.seconds ?? 0;
            return tb - ta;
          });

        // Il cliente è il documento parent — costruiamo il ref dall'ID
        const clienteRefs = prevs
          .filter((p) => p._clienteId)
          .map((p) => doc(db, "Clienti", p._clienteId)) as DocumentReference[];
        const clientiMap  = await batchGetDocs(clienteRefs);

        const resolved: PrevRow[] = prevs.map((prev) => {
          const refPath = prev._clienteId ? `Clienti/${prev._clienteId}` : "";
          const c = refPath ? clientiMap.get(refPath) : undefined;
          const clienteNome = c
            ? ((c.Azienda && c.Ragione_Sociale) ? (c.Ragione_Sociale as string) : ((c.Nome as string)?.trim() || "—"))
            : "—";
          return { prev, clienteNome, stato: getStato(prev) };
        });

        setEntries(resolved);
      } catch (e) {
        toast.error("Errore nel caricamento preventivi");
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const filtered = entries.filter(({ prev, clienteNome, stato: s }) => {
    const numero = prev.ID != null ? `#${prev.ID}` : `#${prev.id.slice(0, 6).toUpperCase()}`;
    const matchSearch = !search || [numero, clienteNome].join(" ").toLowerCase().includes(search.toLowerCase());
    const matchStato  = !stato  || s === stato;
    return matchSearch && matchStato;
  });

  const counts = {
    totale:    entries.length,
    accettato: entries.filter((e) => e.stato === "Accettato").length,
    attesa:    entries.filter((e) => e.stato === "In attesa").length,
  };

  function reset() {
    setSearch("");
    setStato("");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
            Preventivi
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "Caricamento…" : `${filtered.length} preventivi`}
          </p>
        </div>
        <Link
          href="/preventivi/nuova"
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl flex-shrink-0"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
        >
          <Plus size={16} />
          Nuovo preventivo
        </Link>
      </div>

      {!loading && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            { label: "Totale",    val: counts.totale,    color: "var(--brand)" },
            { label: "Accettati", val: counts.accettato, color: "#249689" },
            { label: "In attesa", val: counts.attesa,    color: "#6B7280" },
          ].map(({ label, val, color }) => (
            <div
              key={label}
              className="rounded-2xl p-4"
              style={{ background: "#fff", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}
            >
              <div className="flex items-center gap-2 mb-1">
                <FileText size={16} style={{ color }} />
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  {label}
                </span>
              </div>
              <p className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                {val}
              </p>
            </div>
          ))}
        </div>
      )}

      <Card>
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per numero, cliente…"
              className="w-full pl-9 pr-4 py-2 rounded-xl text-sm"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
            />
          </div>
          <select
            value={stato}
            onChange={(e) => setStato(e.target.value as StatoLabel | "")}
            className="text-sm px-3 py-2 rounded-xl"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
          >
            <option value="">Tutti gli stati</option>
            <option value="Accettato">Accettato</option>
            <option value="In attesa">In attesa</option>
          </select>
          {(search || stato) && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}
            >
              <X size={14} /> Azzera
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: "var(--bg-primary)" }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-2 py-12 text-center text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
            <FileText size={32} className="mx-auto mb-2 opacity-40" />
            <p>Nessun preventivo trovato</p>
          </div>
        ) : (
          <>
            {/* Mobile: lista a card */}
            <div className="md:hidden space-y-2.5">
              {filtered.map(({ prev, clienteNome, stato: s }) => {
                const numero = prev.ID != null ? `#${prev.ID}` : `#${prev.id.slice(0, 6).toUpperCase()}`;
                return (
                  <div
                    key={prev.id}
                    className="rounded-xl p-3.5"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="font-bold text-sm" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                        {numero}
                      </span>
                      <Badge variant={statoVariant[s]}>{s}</Badge>
                    </div>
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                      {clienteNome}
                    </p>
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1.5 text-xs" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                      <span>{prev.Data ?? formatData(prev.Data_Creazione)}</span>
                      <span style={{ color: "var(--text-muted)" }}>·</span>
                      <span>{contaPezzi(prev)}</span>
                      {prev.Data_Accettazione && (
                        <>
                          <span style={{ color: "var(--text-muted)" }}>·</span>
                          <span>Acc. {formatData(prev.Data_Accettazione)}</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <Link
                        href={`/preventivi/${prev._clienteId}/${prev.id}`}
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg"
                        style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)", border: "1px solid var(--border)" }}
                      >
                        <Eye size={13} />
                        Visualizza
                      </Link>
                      <Link
                        href={`/preventivi/${prev._clienteId}/${prev.id}/modifica`}
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg"
                        style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
                      >
                        <Pencil size={13} />
                        Modifica
                      </Link>
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
                    {["Numero", "Cliente", "Data", "Accettazione", "Pezzi", "Stato", "Azioni"].map((h) => (
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
                  {filtered.map(({ prev, clienteNome, stato: s }) => {
                    const numero = prev.ID != null ? `#${prev.ID}` : `#${prev.id.slice(0, 6).toUpperCase()}`;
                    return (
                    <tr
                      key={prev.id}
                      className="hover:bg-[#F1F4F8] transition-colors cursor-pointer"
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <td className="px-2 py-3 font-semibold" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                        {numero}
                      </td>
                      <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {clienteNome}
                      </td>
                      <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {prev.Data ?? formatData(prev.Data_Creazione)}
                      </td>
                      <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {prev.Data_Accettazione ? formatData(prev.Data_Accettazione) : "—"}
                      </td>
                      <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                        {contaPezzi(prev)}
                      </td>
                      <td className="px-2 py-3">
                        <Badge variant={statoVariant[s]}>{s}</Badge>
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/preventivi/${prev._clienteId}/${prev.id}`}
                            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors hover:bg-[#F1F4F8]"
                            style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)", border: "1px solid var(--border)" }}
                          >
                            <Eye size={13} />
                            Visualizza
                          </Link>
                          <Link
                            href={`/preventivi/${prev._clienteId}/${prev.id}/modifica`}
                            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                            style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
                          >
                            <Pencil size={13} />
                            Modifica
                          </Link>
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
