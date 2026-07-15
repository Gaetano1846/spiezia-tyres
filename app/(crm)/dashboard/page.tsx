"use client";

import { useState, useEffect, useCallback } from "react";
import {
  collection, collectionGroup, query, where, getDocs, getDoc,
  limit, updateDoc, doc,
  Timestamp, type DocumentReference,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Calendar, Users, FileText, Wrench, Clock, Bell, CheckCircle2 } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Link from "next/link";
import toast from "react-hot-toast";
import { useAuth } from "@/components/layout/AuthProvider";
import type { AppuntamentoApi } from "@/lib/appuntamentiDb";

const statoVariant: Record<string, "success" | "brand" | "neutral"> = {
  Completato:  "success",
  "In corso":  "brand",
  Programmato: "neutral",
};

type PromemoriaItem = {
  id: string;
  Titolo: string;
  Data?: Timestamp;
  ClienteRef?: DocumentReference;
  clienteNome?: string;
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

/** Appuntamenti: DataOra ora arriva come ISO string da /api/appuntamenti (Postgres). */
function formatOra(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

/** Promemoria: Data resta un Timestamp Firestore (dominio non migrato — vedi nota in fetchAll). */
function formatData(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
}

type KPIs = {
  clientiCount: number;
  appOggiCount: number;
  prevApertiCount: number;
  fogliAttiviCount: number;
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [kpis, setKpis]             = useState<KPIs | null>(null);
  const [appOggi, setAppOggi]       = useState<AppuntamentoApi[]>([]);
  const [promemoria, setPromemoria] = useState<PromemoriaItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [markingId, setMarkingId]   = useState<string | null>(null);

  const today = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

  const fetchAll = useCallback(async (uid: string) => {
    const now        = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    try {
      // Clienti/Appuntamenti/Foglio_di_Lavoro: Postgres via API (Fase 7 — prima
      // leggevano Firestore direttamente). Preventivi (collectionGroup) e
      // Promemoria (sotto-collezione users/{uid}/Promemoria) restano
      // volontariamente su Firestore: dominio Preventivi fuori scope di questa
      // fase (altro workstream), Promemoria non ha ancora uno schema Postgres
      // dedicato — vedi nota più sotto.
      const [clientiRes, appRes, prevSnap, fogliRes, promemoriaSnap] = await Promise.all([
        fetch(`/api/clienti?limit=1`),
        fetch(`/api/appuntamenti?from=${encodeURIComponent(startOfDay.toISOString())}&to=${encodeURIComponent(endOfDay.toISOString())}`),
        getDocs(query(collectionGroup(db, "Preventivo"), limit(500))),
        fetch(`/api/fogli-di-lavoro?limit=1000`),
        getDocs(query(
          // I promemoria CRM vengono creati dalla scheda cliente in questo store
          // condiviso (campo "Completata"). La dashboard mostra quelli ancora aperti.
          collection(db, "users", "promemoria_crm", "Promemoria"),
          where("Completata", "==", false),
          limit(50),
        )),
      ]);

      if (!clientiRes.ok) throw new Error(`clienti ${clientiRes.status}`);
      if (!appRes.ok) throw new Error(`appuntamenti ${appRes.status}`);
      if (!fogliRes.ok) throw new Error(`fogli ${fogliRes.status}`);

      const { total: clientiCount } = (await clientiRes.json()) as { total?: number };
      const { appuntamenti: apps } = (await appRes.json()) as { appuntamenti: AppuntamentoApi[] };
      const { fogli } = (await fogliRes.json()) as { fogli: Array<{ Stato: string }> };

      // "Aperti" = non ancora accettati né rifiutati. I preventivi nascono
      // con Stato "In attesa" (e flag Accettato=false), quindi non basta
      // contare Bozza/Inviato: includiamo tutto ciò che è ancora da lavorare.
      const prevAperti = prevSnap.docs.filter((d) => {
        const data = d.data();
        if (data.Accettato === true) return false;
        const stato = (data.Stato as string) ?? "In attesa";
        return !["Accettato", "Rifiutato"].includes(stato);
      }).length;

      const fogliAttivi = fogli.filter((f) => f.Stato !== "Completato" && f.Stato !== "Chiuso").length;

      // Promemoria: raw docs, resolve cliente nomi in batch
      const promRaw: PromemoriaItem[] = promemoriaSnap.docs.map((d) => ({
        id: d.id,
        // La scheda cliente salva il titolo in "Nome" e la data in "Data_Scadenza".
        Titolo: (d.data().Nome ?? d.data().Titolo ?? "Promemoria") as string,
        Data: (d.data().Data_Scadenza ?? d.data().Data) as Timestamp | undefined,
        ClienteRef: d.data().Cliente as DocumentReference | undefined,
      }));

      const clienteRefsPromo = promRaw.map((p) => p.ClienteRef).filter(Boolean) as DocumentReference[];
      const clientiMapPromo = await batchGetDocs(clienteRefsPromo);

      const promWithCliente: PromemoriaItem[] = promRaw.map((p) => ({
        ...p,
        clienteNome: p.ClienteRef
          ? (() => {
              const c = clientiMapPromo.get(p.ClienteRef!.path);
              return c ? ((c.Ragione_Sociale ?? c.Nome ?? "") as string) : undefined;
            })()
          : undefined,
      }));

      // Filter: mostra solo quelli con Data <= oggi (o senza data)
      const todayTs = Timestamp.fromDate(endOfDay);
      const promoFiltrati = promWithCliente
        .filter((p) => !p.Data || p.Data.seconds <= todayTs.seconds)
        .sort((a, b) => (a.Data?.seconds ?? 0) - (b.Data?.seconds ?? 0));

      setKpis({
        clientiCount:     clientiCount ?? 0,
        appOggiCount:     apps.length,
        prevApertiCount:  prevAperti,
        fogliAttiviCount: fogliAttivi,
      });
      setAppOggi(apps);
      setPromemoria(promoFiltrati);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    fetchAll(user.uid);
  }, [user?.uid, fetchAll]);

  async function handleMarkDone(promemoriaId: string) {
    if (!user?.uid || markingId) return;
    setMarkingId(promemoriaId);
    try {
      await updateDoc(doc(db, "users", "promemoria_crm", "Promemoria", promemoriaId), { Completata: true });
      setPromemoria((prev) => prev.filter((p) => p.id !== promemoriaId));
      toast.success("Promemoria completato");
    } catch {
      toast.error("Errore nel completare il promemoria");
    } finally {
      setMarkingId(null);
    }
  }

  const statCards = [
    { label: "Appuntamenti oggi",   value: kpis?.appOggiCount    ?? 0, sub: "giornata corrente",   icon: Calendar, accent: "#FFC803" },
    { label: "Preventivi aperti",   value: kpis?.prevApertiCount  ?? 0, sub: "bozze + inviati",     icon: FileText, accent: "#249689" },
    { label: "Fogli attivi",        value: kpis?.fogliAttiviCount ?? 0, sub: "in lavorazione",      icon: Wrench,   accent: "#EE8B60" },
    { label: "Clienti totali",      value: kpis?.clientiCount     ?? 0, sub: "nel database",        icon: Users,    accent: "#3B82F6" },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
          Dashboard
        </h1>
        <p className="text-sm mt-0.5 sm:mt-1 capitalize" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
          {today}
        </p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {statCards.map(({ label, value, sub, icon: Icon, accent }) => (
          <div
            key={label}
            className="rounded-2xl p-4 sm:p-5"
            style={{ background: "#fff", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}
          >
            <div className="flex items-center justify-between mb-2 sm:mb-3">
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
              <p className="text-2xl sm:text-3xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                {value}
              </p>
            )}
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              {sub}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
        {/* Appuntamenti oggi */}
        <div className="xl:col-span-2">
          <Card padding="none" className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-3 sm:mb-5">
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
              <div className="text-center py-6 sm:py-10" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                <Calendar size={28} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nessun appuntamento per oggi</p>
              </div>
            ) : (
              <div className="space-y-1">
                {appOggi.map((app) => {
                  const servizioNome = app.Servizi?.map((s) => s.Titolo).join(", ") ?? "—";
                  return (
                    <div
                      key={app.id}
                      className="flex items-center gap-4 px-4 py-3 rounded-xl transition-colors hover:bg-[#F1F4F8] cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 w-14 flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                        <Clock size={13} />
                        <span className="text-xs font-medium" style={{ fontFamily: "var(--font-montserrat)" }}>
                          {formatOra(app.DataOra)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ fontFamily: "var(--font-montserrat)" }}>
                          {app.ClienteNome}
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

        {/* Promemoria */}
        <div className="xl:col-span-1">
          <Card padding="none" className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-3 sm:mb-5">
              <div className="flex items-center gap-2">
                <Bell size={16} style={{ color: "var(--brand)" }} />
                <h2 className="font-bold text-base" style={{ fontFamily: "var(--font-poppins)" }}>
                  Promemoria
                </h2>
                {promemoria.length > 0 && (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: "var(--brand)", color: "#111" }}
                  >
                    {promemoria.length}
                  </span>
                )}
              </div>
            </div>

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: "var(--bg-primary)" }} />
                ))}
              </div>
            ) : promemoria.length === 0 ? (
              <div className="text-center py-5 sm:py-8" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                <CheckCircle2 size={28} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">Nessun promemoria in scadenza</p>
              </div>
            ) : (
              <div className="space-y-2">
                {promemoria.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-start gap-3 px-3 py-2.5 rounded-xl"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                        {p.Titolo}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {p.Data && (
                          <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                            {formatData(p.Data)}
                          </span>
                        )}
                        {p.clienteNome && (
                          <span className="text-xs truncate" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                            · {p.clienteNome}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleMarkDone(p.id)}
                      disabled={markingId === p.id}
                      title="Segna come completato"
                      className="flex-shrink-0 p-1.5 rounded-lg transition-colors hover:bg-green-50 disabled:opacity-40"
                    >
                      <CheckCircle2 size={16} style={{ color: markingId === p.id ? "var(--text-muted)" : "#16a34a" }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
