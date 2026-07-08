"use client";

import { useState, useEffect } from "react";
import { Plus, Calendar, User, Wrench, MapPin, Search, X, Pencil } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import toast from "react-hot-toast";
import type { AppuntamentoApi } from "@/lib/appuntamentiDb";

const statoVariant: Record<string, "success" | "brand" | "warning" | "neutral" | "error"> = {
  "In Attesa":  "neutral",
  "In corso":   "brand",
  Programmato:  "warning",
  Completato:   "success",
  Annullato:    "error",
};

// Intervento/servizio: campo "Intervento" (stringa, app Flutter) oppure array "Servizi" (app nuova).
function interventoFrom(app: AppuntamentoApi): string {
  if (app.Intervento?.trim()) return app.Intervento.trim();
  const servizi = (app.Servizi ?? []).map((s) => s.Titolo).filter(Boolean);
  return servizi.length ? servizi.join(", ") : "—";
}

function formatOra(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function formatData(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

export default function AppuntamentiPage() {
  const [entries, setEntries]   = useState<AppuntamentoApi[]>([]);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState<"Oggi" | "Tutti">("Oggi");
  const [search, setSearch]     = useState("");
  const [stato, setStato]       = useState<string>("");

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/appuntamenti");
        if (!res.ok) throw new Error(String(res.status));
        const { appuntamenti } = await res.json();
        setEntries(appuntamenti);
      } catch (e) {
        toast.error("Errore nel caricamento appuntamenti");
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const filtered = entries.filter((app) => {
    const byTab = activeTab === "Oggi" ? isToday(app.DataOra) : true;
    const matchSearch = !search || [app.ClienteNome, interventoFrom(app)].join(" ").toLowerCase().includes(search.toLowerCase());
    const matchStato  = !stato || app.Stato === stato;
    return byTab && matchSearch && matchStato;
  });

  const oggiCount = entries.filter((app) => isToday(app.DataOra)).length;

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
            onChange={(e) => setStato(e.target.value)}
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
            {filtered.map((app) => {
              return (
                <div
                  key={app.id}
                  className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4 hover:bg-[#F1F4F8] transition-colors cursor-pointer"
                  style={{ border: "1px solid var(--border)" }}
                >
                  <div className="flex-shrink-0 w-20">
                    <p className="text-sm font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                      {formatOra(app.DataOra)}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Calendar size={11} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                      <p className="text-xs leading-tight" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                        {formatData(app.DataOra)}
                      </p>
                    </div>
                  </div>

                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="flex items-center gap-1.5">
                      <User size={13} style={{ color: "var(--text-muted)" }} />
                      <span className="text-sm font-semibold truncate" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                        {app.ClienteNome}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Wrench size={13} style={{ color: "var(--text-muted)" }} />
                      <span className="text-sm" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
                        {interventoFrom(app)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MapPin size={13} style={{ color: "#2563EB" }} />
                      <span className="text-sm font-medium" style={{ fontFamily: "var(--font-montserrat)", color: "#2563EB" }}>
                        {app.SedeNome}
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
