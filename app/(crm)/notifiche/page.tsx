"use client";

import { useState, useEffect } from "react";
import {
  collection, query, orderBy, limit, getDocs, updateDoc, doc, writeBatch,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Bell, CheckCheck, ShoppingBag, FileText, Calendar, Settings, X } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import toast from "react-hot-toast";
import type { Notifica } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTs(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "—";
  const d = ts.toDate();
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "ora";
  if (diffMin < 60) return `${diffMin} min fa`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} h fa`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD} g fa`;
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
}

const tipoIcon: Record<string, React.ElementType> = {
  ordine:       ShoppingBag,
  preventivo:   FileText,
  appuntamento: Calendar,
  sistema:      Settings,
};

const tipoVariant: Record<string, "brand" | "success" | "neutral" | "warning"> = {
  ordine:       "brand",
  preventivo:   "success",
  appuntamento: "warning",
  sistema:      "neutral",
};

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "var(--bg-primary)" }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NotifichePage() {
  const [notifiche, setNotifiche] = useState<Notifica[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<"tutte" | "non-lette">("non-lette");
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(
          query(collection(db, "Notifiche"), orderBy("DataCreazione", "desc"), limit(100)),
        );
        setNotifiche(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Notifica)));
      } catch (e) {
        toast.error("Errore nel caricamento notifiche");
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const displayed = filter === "non-lette"
    ? notifiche.filter((n) => !n.Visto)
    : notifiche;

  const nonLetteCount = notifiche.filter((n) => !n.Visto).length;

  async function markAsRead(id: string) {
    setNotifiche((prev) => prev.map((n) => n.id === id ? { ...n, Visto: true } : n));
    try {
      await updateDoc(doc(db, "Notifiche", id), { Visto: true });
    } catch {
      toast.error("Errore aggiornamento notifica");
    }
  }

  async function markAllAsRead() {
    const unread = notifiche.filter((n) => !n.Visto);
    if (unread.length === 0) return;
    setMarkingAll(true);
    try {
      const batch = writeBatch(db);
      unread.forEach((n) => batch.update(doc(db, "Notifiche", n.id), { Visto: true }));
      await batch.commit();
      setNotifiche((prev) => prev.map((n) => ({ ...n, Visto: true })));
      toast.success(`${unread.length} notifiche segnate come lette`);
    } catch {
      toast.error("Errore aggiornamento");
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
            Notifiche
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "Caricamento…" : `${nonLetteCount} non lette`}
          </p>
        </div>

        {nonLetteCount > 0 && (
          <button
            onClick={markAllAsRead}
            disabled={markingAll}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40"
            style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
          >
            <CheckCheck size={15} />
            {markingAll ? "Aggiornamento…" : "Segna tutte come lette"}
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
        {(["non-lette", "tutte"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={
              filter === f
                ? { background: "#fff", color: "var(--text-primary)", boxShadow: "var(--shadow-sm)", fontFamily: "var(--font-montserrat)" }
                : { color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }
            }
          >
            {f === "non-lette" ? `Non lette${nonLetteCount > 0 ? ` (${nonLetteCount})` : ""}` : "Tutte"}
          </button>
        ))}
      </div>

      {/* List */}
      <Card padding="none">
        {loading ? (
          <div className="p-4">
            <Skeleton />
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Bell size={36} style={{ color: "var(--text-muted)" }} className="opacity-40" />
            <p className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              {filter === "non-lette" ? "Nessuna notifica non letta" : "Nessuna notifica"}
            </p>
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {displayed.map((n) => {
              const Icon = tipoIcon[n.Tipo] ?? Bell;
              const content = (
                <li
                  key={n.id}
                  className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-[#F9FAFB]"
                  style={!n.Visto ? { background: "#FFFBEB" } : {}}
                >
                  {/* Icon */}
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: n.Visto ? "var(--bg-primary)" : "#FEF3C7", border: "1px solid var(--border)" }}
                  >
                    <Icon size={16} style={{ color: n.Visto ? "var(--text-muted)" : "#D97706" }} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span
                        className="text-sm font-semibold"
                        style={{ fontFamily: "var(--font-montserrat)", color: n.Visto ? "var(--text-secondary)" : "var(--text-primary)" }}
                      >
                        {n.Titolo}
                      </span>
                      {!n.Visto && (
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "var(--brand)" }} />
                      )}
                      <Badge variant={tipoVariant[n.Tipo] ?? "neutral"} className="text-[10px]">
                        {n.Tipo}
                      </Badge>
                    </div>
                    <p className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                      {n.Testo}
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                      {formatTs(n.DataCreazione)}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!n.Visto && (
                      <button
                        onClick={(e) => { e.preventDefault(); markAsRead(n.id); }}
                        title="Segna come letta"
                        className="p-1.5 rounded-lg transition-colors hover:bg-[#F1F4F8]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </li>
              );

              return n.Link ? (
                <Link key={n.id} href={n.Link} onClick={() => !n.Visto && markAsRead(n.id)}>
                  {content}
                </Link>
              ) : (
                <div key={n.id} onClick={() => !n.Visto && markAsRead(n.id)} className="cursor-default">
                  {content}
                </div>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
