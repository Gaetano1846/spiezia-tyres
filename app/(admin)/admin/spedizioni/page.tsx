"use client";

import { useState, useEffect, useMemo } from "react";
import {
  collection,
  query,
  orderBy,
  getDocs,
  getDoc,
  limit,
  type DocumentReference,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Truck, Search, Eye, ExternalLink, X } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import StatCard from "@/components/ui/StatCard";
import toast from "react-hot-toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SpedizioneFS = {
  id: string;
  Ordine?: DocumentReference;
  Cliente?: DocumentReference;
  Vettore?: string;
  Tracking?: string;
  Stato?: string;
  DataCreazione?: Timestamp;
};

type SpedizioneRow = {
  id: string;
  ordineLabel: string;
  clienteLabel: string;
  vettore: string;
  tracking: string;
  data: string;
  stato: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function batchGetDocs(
  refs: DocumentReference[]
): Promise<Map<string, Record<string, unknown>>> {
  if (refs.length === 0) return new Map();
  const unique = [...new Map(refs.map((r) => [r.path, r])).values()];
  const snaps = await Promise.all(unique.map((r) => getDoc(r)));
  const map = new Map<string, Record<string, unknown>>();
  snaps.forEach((s) => {
    if (s.exists())
      map.set(s.ref.path, { id: s.id, ...s.data() } as Record<string, unknown>);
  });
  return map;
}

function formatDate(ts?: Timestamp): string {
  if (!ts) return "—";
  return ts
    .toDate()
    .toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function isToday(ts?: Timestamp): boolean {
  if (!ts) return false;
  const d = ts.toDate();
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

// ---------------------------------------------------------------------------
// Badge mappings
// ---------------------------------------------------------------------------

const statoVariant: Record<string, "warning" | "success" | "error" | "neutral"> = {
  "In transito": "warning",
  Consegnato: "success",
  Anomalia: "error",
  "Da spedire": "neutral",
};

const vettoreVariant: Record<string, "brand" | "success" | "neutral"> = {
  GLS: "brand",
  SDA: "success",
  "Ritiro in negozio": "neutral",
};

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i}>
          <td colSpan={8} className="py-1.5 px-1">
            <div className="h-12 rounded-xl animate-pulse" style={{ background: "var(--bg-primary)" }} />
          </td>
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SpedizioniPage() {
  const [rows, setRows]       = useState<SpedizioneRow[]>([]);
  const [rawDocs, setRawDocs] = useState<SpedizioneFS[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [vettore, setVettore] = useState("");
  const [stato, setStato]     = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const snap = await getDocs(
          query(collection(db, "Spedizioni"), orderBy("DataCreazione", "desc"), limit(200))
        );

        const docs: SpedizioneFS[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<SpedizioneFS, "id">),
        }));

        if (cancelled) return;
        setRawDocs(docs);

        // Collect all refs
        const ordineRefs: DocumentReference[] = docs
          .filter((d) => d.Ordine)
          .map((d) => d.Ordine as DocumentReference);
        const clienteRefs: DocumentReference[] = docs
          .filter((d) => d.Cliente)
          .map((d) => d.Cliente as DocumentReference);

        const [ordiniMap, clientiMap] = await Promise.all([
          batchGetDocs(ordineRefs),
          batchGetDocs(clienteRefs),
        ]);

        if (cancelled) return;

        const built: SpedizioneRow[] = docs.map((d) => {
          // Ordine label
          let ordineLabel = "—";
          if (d.Ordine) {
            const od = ordiniMap.get(d.Ordine.path);
            if (od) {
              ordineLabel =
                (od.Numero as string | undefined) ??
                `#${(od.id as string).slice(0, 8).toUpperCase()}`;
            }
          }

          // Cliente label
          let clienteLabel = "—";
          if (d.Cliente) {
            const cd = clientiMap.get(d.Cliente.path);
            if (cd) {
              clienteLabel =
                (cd.Azienda as string | undefined) ||
                `${(cd.Nome as string | undefined) ?? ""} ${(cd.Cognome as string | undefined) ?? ""}`.trim() ||
                "—";
            }
          }

          return {
            id: d.id,
            ordineLabel,
            clienteLabel,
            vettore: d.Vettore ?? "—",
            tracking: d.Tracking ?? "—",
            data: formatDate(d.DataCreazione),
            stato: d.Stato ?? "—",
          };
        });

        setRows(built);
      } catch (err) {
        console.error(err);
        toast.error("Errore nel caricamento delle spedizioni");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // -------------------------------------------------------------------------
  // Stats computed from raw docs (no extra queries)
  // -------------------------------------------------------------------------

  const stats = useMemo(() => {
    const daSpedire       = rawDocs.filter((d) => d.Stato === "Da spedire").length;
    const inTransito      = rawDocs.filter((d) => d.Stato === "In transito").length;
    const consegnateOggi  = rawDocs.filter((d) => d.Stato === "Consegnato" && isToday(d.DataCreazione)).length;
    const anomalie        = rawDocs.filter((d) => d.Stato === "Anomalia").length;
    return [
      { label: "Da spedire",      value: daSpedire,      sub: "in attesa",     icon: <Truck size={22} />, accent: "#FFC803" },
      { label: "In transito",     value: inTransito,      sub: "in viaggio",    icon: <Truck size={22} />, accent: "#EE8B60" },
      { label: "Consegnate oggi", value: consegnateOggi,  sub: "confermate",    icon: <Truck size={22} />, accent: "#249689" },
      { label: "Anomalie",        value: anomalie,        sub: "da verificare", icon: <Truck size={22} />, accent: "#FF5963" },
    ];
  }, [rawDocs]);

  // -------------------------------------------------------------------------
  // Filters
  // -------------------------------------------------------------------------

  const filtered = useMemo(() => {
    return rows.filter((s) => {
      const matchSearch =
        !search ||
        [s.id, s.ordineLabel, s.clienteLabel, s.tracking]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
      const matchVettore = !vettore || s.vettore === vettore;
      const matchStato   = !stato   || s.stato   === stato;
      return matchSearch && matchVettore && matchStato;
    });
  }, [rows, search, vettore, stato]);

  function reset() {
    setSearch("");
    setVettore("");
    setStato("");
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
            Spedizioni
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "Caricamento…" : `${filtered.length} spedizioni`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      <Card padding="sm">
        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="flex-1 min-w-48 relative">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-muted)" }}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per ID, ordine, cliente, tracking…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none"
              style={{
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                fontFamily: "var(--font-montserrat)",
              }}
            />
          </div>
          <select
            value={vettore}
            onChange={(e) => setVettore(e.target.value)}
            className="px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{
              background: "var(--bg-primary)",
              border: "1px solid var(--border)",
              fontFamily: "var(--font-montserrat)",
              color: "var(--text-primary)",
            }}
          >
            <option value="">Tutti i vettori</option>
            <option>GLS</option>
            <option>SDA</option>
            <option>Ritiro in negozio</option>
          </select>
          <select
            value={stato}
            onChange={(e) => setStato(e.target.value)}
            className="px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{
              background: "var(--bg-primary)",
              border: "1px solid var(--border)",
              fontFamily: "var(--font-montserrat)",
              color: "var(--text-primary)",
            }}
          >
            <option value="">Tutti gli stati</option>
            <option>Da spedire</option>
            <option>In transito</option>
            <option>Consegnato</option>
            <option>Anomalia</option>
          </select>
          {(search || vettore || stato) && (
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
                {["ID Spedizione", "Ordine", "Cliente", "Vettore", "Tracking", "Data", "Stato", ""].map((h) => (
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
                <TableSkeleton />
              ) : (
                <>
                  {filtered.map((s) => (
                    <tr
                      key={s.id}
                      className="hover:bg-[#F9FAFB] transition-colors cursor-pointer"
                    >
                      <td className="py-3.5 pr-4 font-semibold" style={{ color: "var(--text-primary)" }}>
                        {s.id.slice(0, 8).toUpperCase()}
                      </td>
                      <td className="py-3.5 pr-4 font-medium" style={{ color: "var(--text-secondary)" }}>
                        {s.ordineLabel}
                      </td>
                      <td className="py-3.5 pr-4" style={{ color: "var(--text-primary)" }}>
                        {s.clienteLabel}
                      </td>
                      <td className="py-3.5 pr-4">
                        <Badge variant={vettoreVariant[s.vettore] ?? "neutral"}>{s.vettore}</Badge>
                      </td>
                      <td className="py-3.5 pr-4 font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
                        {s.tracking}
                      </td>
                      <td className="py-3.5 pr-4" style={{ color: "var(--text-secondary)" }}>
                        {s.data}
                      </td>
                      <td className="py-3.5 pr-4">
                        <Badge variant={statoVariant[s.stato] ?? "neutral"}>{s.stato}</Badge>
                      </td>
                      <td className="py-3.5">
                        <div className="flex items-center gap-2">
                          <button
                            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full"
                            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
                          >
                            <Eye size={12} />
                          </button>
                          {s.tracking !== "—" && (
                            <button
                              className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full"
                              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
                            >
                              <ExternalLink size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-12 text-center text-sm"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Nessuna spedizione trovata.
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
