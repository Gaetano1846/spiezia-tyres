"use client";

import { useState, useEffect } from "react";
import {
  collection, collectionGroup, query, where, getDocs, getDoc, getCountFromServer, limit,
  Timestamp, type DocumentReference,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Calendar, Users, FileText, Wrench, Clock } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Link from "next/link";
import type { Appuntamento, AppuntamentoStato } from "@/lib/types";

const statoVariant: Record<string, "success" | "brand" | "neutral"> = {
  Completato:  "success",
  "In corso":  "brand",
  Programmato: "neutral",
};

type AppEntry = {
  app: Appuntamento;
  clienteNome: string;
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

function formatOra(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

type KPIs = {
  clientiCount: number;
  appOggiCount: number;
  prevApertiCount: number;
  fogliAttiviCount: number;
};

export default function DashboardPage() {
  const [kpis, setKpis]         = useState<KPIs | null>(null);
  const [appOggi, setAppOggi]   = useState<AppEntry[]>([]);
  const [loading, setLoading]   = useState(true);

  const today = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

  useEffect(() => {
    const fetchAll = async () => {
      const now        = new Date();
      const startOfDay = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0));
      const endOfDay   = Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59));

      try {
        const [clientiSnap, appSnap, prevSnap, fogliSnap] = await Promise.all([
          getCountFromServer(collection(db, "Clienti")),
          getDocs(query(
            collection(db, "Appuntamenti"),
            where("DataOra", ">=", startOfDay),
            where("DataOra", "<=", endOfDay),
          )),
          getDocs(query(collectionGroup(db, "Preventivo"), limit(500))),
          // Stato spesso non è scritto in Firestore: viene calcolato da Ora_Fine/Ora_Inizio
          // quindi si fetch e si conta lato client con la stessa logica della lista fogli
          getDocs(query(collection(db, "Foglio_di_Lavoro"), limit(1000))),
        ]);

        const apps = appSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Appuntamento))
          .sort((a, b) => {
            const ta = (a.DataOra as Timestamp)?.seconds ?? 0;
            const tb = (b.DataOra as Timestamp)?.seconds ?? 0;
            return ta - tb;
          });

        const clienteRefs = apps.map((a) => a.Cliente).filter(Boolean) as DocumentReference[];
        const clientiMap  = await batchGetDocs(clienteRefs);

        const resolved: AppEntry[] = apps.map((app) => {
          const c = app.Cliente ? clientiMap.get(app.Cliente.path) : undefined;
          const clienteNome = c
            ? ((c.Azienda && c.Ragione_Sociale) ? (c.Ragione_Sociale as string) : ((c.Nome as string)?.trim() || "—"))
            : "—";
          return { app, clienteNome };
        });

        const prevAperti = prevSnap.docs.filter(
          (d) => ["Bozza", "Inviato"].includes(d.data().Stato as string)
        ).length;

        const fogliAttivi = fogliSnap.docs.filter((d) => {
          const data = d.data();
          if (data.Stato) return data.Stato !== "Completato" && data.Stato !== "Chiuso";
          return !data.Ora_Fine; // calcolato: Ora_Fine presente → Completato
        }).length;

        setKpis({
          clientiCount:     clientiSnap.data().count,
          appOggiCount:     apps.length,
          prevApertiCount:  prevAperti,
          fogliAttiviCount: fogliAttivi,
        });
        setAppOggi(resolved);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const statCards = [
    { label: "Appuntamenti oggi",   value: kpis?.appOggiCount    ?? 0, sub: "giornata corrente",   icon: Calendar, accent: "#FFC803" },
    { label: "Preventivi aperti",   value: kpis?.prevApertiCount  ?? 0, sub: "bozze + inviati",     icon: FileText, accent: "#249689" },
    { label: "Fogli attivi",        value: kpis?.fogliAttiviCount ?? 0, sub: "in lavorazione",      icon: Wrench,   accent: "#EE8B60" },
    { label: "Clienti totali",      value: kpis?.clientiCount     ?? 0, sub: "nel database",        icon: Users,    accent: "#3B82F6" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
          Dashboard
        </h1>
        <p className="text-sm mt-1 capitalize" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
          {today}
        </p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map(({ label, value, sub, icon: Icon, accent }) => (
          <div
            key={label}
            className="rounded-2xl p-5"
            style={{ background: "#fff", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                {label}
              </span>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${accent}1A` }}>
                <Icon size={16} style={{ color: accent }} />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-16 rounded animate-pulse" style={{ background: "var(--bg-primary)" }} />
            ) : (
              <p className="text-3xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                {value}
              </p>
            )}
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              {sub}
            </p>
          </div>
        ))}
      </div>

      <Card>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-base" style={{ fontFamily: "var(--font-poppins)" }}>
            Appuntamenti di oggi
          </h2>
          <Link
            href="/appuntamenti"
            className="text-xs font-semibold px-4 py-1.5 rounded-full"
            style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
          >
            Vedi tutti
          </Link>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: "var(--bg-primary)" }} />
            ))}
          </div>
        ) : appOggi.length === 0 ? (
          <div className="text-center py-10" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
            <Calendar size={28} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nessun appuntamento per oggi</p>
          </div>
        ) : (
          <div className="space-y-1">
            {appOggi.map(({ app, clienteNome }) => {
              const servizioNome = app.Servizi?.map((s) => s.Titolo).join(", ") ?? "—";
              return (
                <div
                  key={app.id}
                  className="flex items-center gap-4 px-4 py-3 rounded-xl transition-colors hover:bg-[#F1F4F8] cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 w-14 flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                    <Clock size={13} />
                    <span className="text-xs font-medium" style={{ fontFamily: "var(--font-montserrat)" }}>
                      {formatOra(app.DataOra as Timestamp)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ fontFamily: "var(--font-montserrat)" }}>
                      {clienteNome}
                    </p>
                    <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                      {servizioNome}
                    </p>
                  </div>
                  <Badge variant={statoVariant[app.Stato] ?? "neutral"}>{app.Stato}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
