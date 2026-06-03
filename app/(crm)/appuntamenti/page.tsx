"use client";

import { useState, useEffect } from "react";
import {
  collection, query, orderBy, getDocs, getDoc, limit,
  type DocumentReference, type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Plus, Calendar, User, Wrench, MapPin, Search, X, Pencil } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import toast from "react-hot-toast";
import type { Appuntamento, AppuntamentoStato } from "@/lib/types";

const statoVariant: Record<string, "success" | "brand" | "warning" | "neutral" | "error"> = {
  "In Attesa":  "neutral",
  "In corso":   "brand",
  Programmato:  "warning",
  Completato:   "success",
  Annullato:    "error",
};

type AppEntry = {
  app: Appuntamento;
  clienteNome: string;
  sedeNome: string;
  servizioNome: string;
};

// Nome cliente robusto: azienda → Ragione_Sociale, persona → Nome; fallback all'altro campo
// (gli appuntamenti storici hanno spesso solo Ragione_Sociale, senza il flag Azienda).
function nomeClienteFrom(c: Record<string, unknown>): string {
  const rs   = (c.Ragione_Sociale as string)?.trim();
  const nome = (c.Nome as string)?.trim();
  if (c.Azienda === true && rs) return rs;
  return nome || rs || "—";
}

// Intervento/servizio: campo "Intervento" (stringa, app Flutter) oppure array "Servizi" (app nuova).
function interventoFrom(app: Appuntamento): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const intervento = ((app as any).Intervento as string)?.trim();
  if (intervento) return intervento;
  const servizi = (app.Servizi ?? []).map((s) => s.Titolo).filter(Boolean);
  return servizi.length ? servizi.join(", ") : "—";
}

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

function formatOra(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function formatData(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function isToday(ts: Timestamp | null | undefined): boolean {
  if (!ts?.toDate) return false;
  const d = ts.toDate();
  const n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

export default function AppuntamentiPage() {
  const [entries, setEntries]   = useState<AppEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState<"Oggi" | "Tutti">("Oggi");
  const [search, setSearch]     = useState("");
  const [stato, setStato]       = useState<AppuntamentoStato | "">("");

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const q = query(collection(db, "Appuntamenti"), orderBy("DataOra", "desc"), limit(200));
        const snap = await getDocs(q);
        const apps = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Appuntamento));

        const clienteRefs = apps.map((a) => a.Cliente).filter(Boolean) as DocumentReference[];
        const sedeRefs    = apps.map((a) => a.Sede).filter(Boolean) as DocumentReference[];
        const [clientiMap, sediMap] = await Promise.all([
          batchGetDocs(clienteRefs),
          batchGetDocs(sedeRefs),
        ]);

        const resolved: AppEntry[] = apps.map((app) => {
          const c = app.Cliente ? clientiMap.get(app.Cliente.path) : undefined;
          const s = app.Sede ? sediMap.get(app.Sede.path) : undefined;
          const clienteNome  = c ? nomeClienteFrom(c) : "—";
          const sedeNome     = s ? (s.Nome as string) ?? "—" : "—";
          const servizioNome = interventoFrom(app);
          return { app, clienteNome, sedeNome, servizioNome };
        });

        setEntries(resolved);
      } catch (e) {
        toast.error("Errore nel caricamento appuntamenti");
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const filtered = entries.filter(({ app, clienteNome, servizioNome }) => {
    const byTab = activeTab === "Oggi" ? isToday(app.DataOra as Timestamp) : true;
    const matchSearch = !search || [clienteNome, servizioNome].join(" ").toLowerCase().includes(search.toLowerCase());
    const matchStato  = !stato || app.Stato === stato;
    return byTab && matchSearch && matchStato;
  });

  const oggiCount = entries.filter(({ app }) => isToday(app.DataOra as Timestamp)).length;

  function reset() {
    setSearch("");
    setStato("");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
            Appuntamenti
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "Caricamento…" : `${oggiCount} appuntamenti oggi`}
          </p>
        </div>
        <Link
          href="/appuntamenti/nuova"
          className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl flex-shrink-0"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
        >
          <Plus size={16} />
          Nuovo
        </Link>
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per cliente, servizio…"
              className="w-full pl-9 pr-4 py-2 rounded-xl text-sm"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
            />
          </div>
          <select
            value={stato}
            onChange={(e) => setStato(e.target.value as AppuntamentoStato | "")}
            className="text-sm px-3 py-2 rounded-xl"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}
          >
            <option value="">Tutti gli stati</option>
            <option value="In Attesa">In Attesa</option>
            <option value="In corso">In corso</option>
            <option value="Programmato">Programmato</option>
            <option value="Completato">Completato</option>
            <option value="Annullato">Annullato</option>
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

        <div className="flex gap-1 mb-5" style={{ borderBottom: "1px solid var(--border)" }}>
          {(["Oggi", "Tutti"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2.5 text-sm font-semibold transition-colors"
              style={{
                fontFamily: "var(--font-montserrat)",
                color: activeTab === tab ? "var(--text-primary)" : "var(--text-muted)",
                borderBottom: activeTab === tab ? "2px solid var(--brand)" : "2px solid transparent",
                marginBottom: "-1px",
              }}
            >
              {tab === "Oggi" ? `Oggi (${oggiCount})` : `Tutti (${entries.length})`}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "var(--bg-primary)" }} />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(({ app, clienteNome, sedeNome, servizioNome }) => {
              return (
                <div
                  key={app.id}
                  className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4 hover:bg-[#F1F4F8] transition-colors cursor-pointer"
                  style={{ border: "1px solid var(--border)" }}
                >
                  <div className="flex-shrink-0 w-20">
                    <p className="text-sm font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                      {formatOra(app.DataOra as Timestamp)}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Calendar size={11} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                      <p className="text-xs leading-tight" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                        {formatData(app.DataOra as Timestamp)}
                      </p>
                    </div>
                  </div>

                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="flex items-center gap-1.5">
                      <User size={13} style={{ color: "var(--text-muted)" }} />
                      <span className="text-sm font-semibold truncate" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                        {clienteNome}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Wrench size={13} style={{ color: "var(--text-muted)" }} />
                      <span className="text-sm" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
                        {servizioNome}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MapPin size={13} style={{ color: "#2563EB" }} />
                      <span className="text-sm font-medium" style={{ fontFamily: "var(--font-montserrat)", color: "#2563EB" }}>
                        {sedeNome}
                      </span>
                    </div>
                  </div>

                  <Badge variant={statoVariant[app.Stato] ?? "neutral"}>{app.Stato}</Badge>

                  <Link
                    href={`/appuntamenti/${app.id}/modifica`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold flex-shrink-0 hover:bg-[#FFF8DC] transition-colors"
                    style={{ border: "1px solid #FFC803", color: "#111", fontFamily: "var(--font-poppins)" }}
                  >
                    <Pencil size={12} /> Modifica
                  </Link>
                </div>
              );
            })}

            {filtered.length === 0 && (
              <div className="text-center py-12" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                <Calendar size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nessun appuntamento trovato</p>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
