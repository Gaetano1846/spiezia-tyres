"use client";

import { useState, useEffect, useCallback } from "react";
import {
  collectionGroup, query, getDocs,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Calendar, Users, FileText, Wrench, Clock, Bell, CheckCircle2 } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Link from "next/link";
import toast from "react-hot-toast";
import { useAuth } from "@/components/layout/AuthProvider";
import type { AppuntamentoApi } from "@/lib/appuntamentiDb";
import type { PromemoriaApi } from "@/lib/promemoriaDb";

const statoVariant: Record<string, "success" | "brand" | "neutral"> = {
  Completato:  "success",
  "In corso":  "brand",
  Programmato: "neutral",
};

/** Appuntamenti: DataOra ora arriva come ISO string da /api/appuntamenti (Postgres). */
function formatOra(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

/** Promemoria: DataScadenza arriva come ISO string da /api/promemoria (Postgres). */
function formatData(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
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
  const [promemoria, setPromemoria] = useState<PromemoriaApi[]>([]);
  const [loading, setLoading]       = useState(true);
  const [markingId, setMarkingId]   = useState<string | null>(null);

  const today = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

  const fetchAll = useCallback(async (uid: string) => {
    const now        = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    try {
      // Clienti/Appuntamenti/Foglio_di_Lavoro/Promemoria: Postgres via API
      // (Fase 7 per Appuntamenti/Fogli; Promemoria chiuso dopo — b2b.promemoria
      // esisteva già ma non era mai stato agganciato a nessuna route).
      // Preventivi (collectionGroup) resta volontariamente su Firestore,
      // fuori scope di questa fase (altro workstream).
      const [clientiRes, appRes, prevSnap, fogliRes, promemoriaRes] = await Promise.all([
        fetch(`/api/clienti?limit=1`),
        fetch(`/api/appuntamenti?from=${encodeURIComponent(startOfDay.toISOString())}&to=${encodeURIComponent(endOfDay.toISOString())}`),
        getDocs(query(collectionGroup(db, "Preventivo"), limit(500))),
        fetch(`/api/fogli-di-lavoro?limit=1000`),
        // I promemoria CRM ancora aperti — la dashboard filtra ulteriormente
        // per data (solo quelli già in scadenza/scaduti) lato client, come prima.
        fetch(`/api/promemoria?completata=false&limit=50`),
      ]);

      if (!clientiRes.ok) throw new Error(`clienti ${clientiRes.status}`);
      if (!appRes.ok) throw new Error(`appuntamenti ${appRes.status}`);
      if (!fogliRes.ok) throw new Error(`fogli ${fogliRes.status}`);
      if (!promemoriaRes.ok) throw new Error(`promemoria ${promemoriaRes.status}`);

      const { total: clientiCount } = (await clientiRes.json()) as { total?: number };
      const { appuntamenti: apps } = (await appRes.json()) as { appuntamenti: AppuntamentoApi[] };
      const { fogli } = (await fogliRes.json()) as { fogli: Array<{ Stato: string }> };
      const { promemoria: promRaw } = (await promemoriaRes.json()) as { promemoria: PromemoriaApi[] };

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

      // Filter: mostra solo quelli con DataScadenza <= oggi (o senza data) —
      // già ordinati asc/nulls-last lato server (ORDER BY data ASC NULLS LAST).
      const endOfDayIso = endOfDay.toISOString();
      const promoFiltrati = promRaw.filter((p) => !p.DataScadenza || p.DataScadenza <= endOfDayIso);

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
      const res = await fetch(`/api/promemoria/${promemoriaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completata: true }),
      });
      if (!res.ok) throw new Error("update failed");
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
                        {p.Nome}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {p.DataScadenza && (
                          <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                            {formatData(p.DataScadenza)}
                          </span>
                        )}
                        {p.ClienteNome && p.ClienteNome !== "—" && (
                          <span className="text-xs truncate" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                            · {p.ClienteNome}
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
