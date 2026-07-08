"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Printer, CheckCircle2, Car, User, MapPin, Clock, Pencil,
} from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import toast from "react-hot-toast";
import type { FoglioApi, PneumaticoFoglio, ServizioFoglio } from "@/lib/fogliDb";

type FoglioStato = "Aperto" | "In lavorazione" | "Completato";

const statoVariant: Record<string, "brand" | "success" | "neutral"> = {
  Aperto:            "neutral",
  "In lavorazione":  "brand",
  Completato:        "success",
};

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

export default function FoglioLavoroDetailPage() {
  const params = useParams();
  const id     = params.id as string;

  const [foglio,      setFoglio]      = useState<FoglioApi | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [savingStato, setSavingStato] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/fogli-di-lavoro/${id}`);
        if (!res.ok) { toast.error("Foglio non trovato"); return; }
        const { foglio: f } = await res.json();
        setFoglio(f);
      } catch (e) {
        toast.error("Errore nel caricamento foglio");
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [id]);

  async function handleStatoChange(nuovoStato: FoglioStato) {
    if (!foglio || savingStato || nuovoStato === foglio.Stato) return;
    setSavingStato(true);
    try {
      const res = await fetch(`/api/fogli-di-lavoro/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stato: nuovoStato }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setFoglio({ ...foglio, Stato: nuovoStato });
      toast.success(`Foglio: ${nuovoStato}`);
    } catch {
      toast.error("Errore aggiornamento stato");
    } finally {
      setSavingStato(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-5 animate-pulse">
        <div className="h-6 w-40 rounded-xl" style={{ background: "var(--bg-secondary)" }} />
        {[100, 140, 180].map((h, i) => (
          <div key={i} className="rounded-2xl" style={{ height: h, background: "var(--bg-secondary)", border: "1px solid var(--border)" }} />
        ))}
      </div>
    );
  }

  if (!foglio) {
    return (
      <div className="text-center py-20" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
        <p className="text-sm">Foglio non trovato.</p>
        <Link href="/fogli-di-lavoro" className="text-sm font-semibold mt-3 inline-block" style={{ color: "var(--brand)" }}>
          ← Torna ai fogli
        </Link>
      </div>
    );
  }

  const dataIso = foglio.DataOra ?? foglio.DataCreazione;

  // Servizi: solo quelli selezionati, divisi per tipo
  const serviziSelezionati = foglio.Servizi.filter((s) => s.Selected);
  const serviziPneu    = serviziSelezionati.filter((s) => s.Tipo === "Pneumatico");
  const serviziVeicolo = serviziSelezionati.filter((s) => s.Tipo === "Veicolo");

  const pneuMontati  = foglio.PneumaticiMontati;
  const pneuSmontati = foglio.PneumaticiSmontati;

  const foglioLabel = foglio.Numero != null ? `#${foglio.Numero}` : `#${id.slice(0, 6).toUpperCase()}`;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back */}
      <Link
        href="/fogli-di-lavoro"
        className="inline-flex items-center gap-1.5 text-sm font-medium"
        style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
      >
        <ArrowLeft size={15} /> Fogli di lavoro
      </Link>

      {/* Header */}
      <Card>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                {foglioLabel}
              </h1>
              <Badge variant={statoVariant[foglio.Stato] ?? "neutral"}>{foglio.Stato}</Badge>
            </div>
            <div className="flex items-center gap-4 text-sm" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
              {dataIso && (
                <span className="flex items-center gap-1">
                  <Clock size={12} style={{ color: "var(--text-muted)" }} />
                  {fmtData(dataIso)} {fmtTime(dataIso)}
                </span>
              )}
              {foglio.SedeNome && foglio.SedeNome !== "—" && (
                <span className="flex items-center gap-1">
                  <MapPin size={12} style={{ color: "var(--text-muted)" }} />
                  {foglio.SedeNome}
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Link
              href={`/fogli-di-lavoro/${id}/stampa`}
              target="_blank"
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl"
              style={{ border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-montserrat)", background: "#fff" }}
            >
              <Printer size={13} /> Stampa PDF
            </Link>
            <Link
              href={`/fogli-di-lavoro/${id}/modifica`}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl"
              style={{ border: "1px solid #FFC803", color: "#111", fontFamily: "var(--font-montserrat)", background: "#fff" }}
            >
              <Pencil size={13} /> Modifica
            </Link>
            {foglio.Stato !== "Completato" && (
              <button
                onClick={() => handleStatoChange(foglio.Stato === "Aperto" ? "In lavorazione" : "Completato")}
                disabled={savingStato}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl disabled:opacity-40"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                <CheckCircle2 size={13} />
                {foglio.Stato === "Aperto" ? "Avvia lavorazione" : "Segna completato"}
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Cliente + Veicolo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card padding="sm">
          <div className="flex items-center gap-2 mb-3">
            <Car size={14} style={{ color: "var(--text-muted)" }} />
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              Veicolo
            </p>
          </div>
          {foglio.VeicoloId ? (
            <div className="space-y-1 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
              <p className="text-xl font-bold font-mono" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                {foglio.VeicoloTarga || "—"}
              </p>
              <p style={{ color: "var(--text-secondary)" }}>
                {[foglio.VeicoloMarca, foglio.VeicoloModello, foglio.VeicoloAnno].filter(Boolean).join(" ")}
              </p>
              {foglio.VeicoloKm != null && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Km: <span className="font-semibold">{foglio.VeicoloKm.toLocaleString("it-IT")}</span>
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>—</p>
          )}
        </Card>

        <Card padding="sm">
          <div className="flex items-center gap-2 mb-3">
            <User size={14} style={{ color: "var(--text-muted)" }} />
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              Cliente
            </p>
          </div>
          {foglio.ClienteId ? (
            <div className="space-y-1 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
              <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{foglio.ClienteNome}</p>
              {foglio.ClienteTelefono && <p style={{ color: "var(--text-secondary)" }}>{foglio.ClienteTelefono}</p>}
              {foglio.ClienteEmail    && <p style={{ color: "var(--text-secondary)" }}>{foglio.ClienteEmail}</p>}
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>—</p>
          )}
        </Card>
      </div>

      {/* Servizi Pneumatici */}
      {serviziPneu.length > 0 && (
        <Card>
          <h2 className="font-bold text-base mb-4" style={{ fontFamily: "var(--font-poppins)" }}>Servizi Pneumatici</h2>
          <ServiziList items={serviziPneu} />
        </Card>
      )}

      {/* Servizi Veicolo */}
      {serviziVeicolo.length > 0 && (
        <Card>
          <h2 className="font-bold text-base mb-4" style={{ fontFamily: "var(--font-poppins)" }}>Servizi Veicolo</h2>
          <ServiziList items={serviziVeicolo} />
        </Card>
      )}

      {/* Servizi non tipizzati (fallback) */}
      {serviziSelezionati.length > 0 && serviziPneu.length === 0 && serviziVeicolo.length === 0 && (
        <Card>
          <h2 className="font-bold text-base mb-4" style={{ fontFamily: "var(--font-poppins)" }}>Servizi eseguiti</h2>
          <ServiziList items={serviziSelezionati} />
        </Card>
      )}

      {/* Pneumatici montati */}
      {pneuMontati.length > 0 && (
        <Card>
          <h2 className="font-bold text-base mb-4" style={{ fontFamily: "var(--font-poppins)" }}>
            Pneumatici montati ({pneuMontati.length})
          </h2>
          <PneumaticiTable items={pneuMontati} showUsura={false} />
        </Card>
      )}

      {/* Pneumatici smontati */}
      {pneuSmontati.length > 0 && (
        <Card>
          <h2 className="font-bold text-base mb-4" style={{ fontFamily: "var(--font-poppins)" }}>
            Pneumatici smontati ({pneuSmontati.length})
          </h2>
          <PneumaticiTable items={pneuSmontati} showUsura />
        </Card>
      )}

      {/* Note */}
      {foglio.Note && (
        <Card>
          <h2 className="font-bold text-base mb-3" style={{ fontFamily: "var(--font-poppins)" }}>Note tecniche</h2>
          <p className="text-sm" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>{foglio.Note}</p>
        </Card>
      )}
    </div>
  );
}

function ServiziList({ items }: { items: ServizioFoglio[] }) {
  return (
    <div className="space-y-2">
      {items.map((s, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-xl"
          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
        >
          <CheckCircle2 size={16} style={{ color: "#249689", flexShrink: 0 }} />
          <span className="flex-1 text-sm" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
            {s.Nome || "—"}
          </span>
          {(s.Quantita ?? 0) > 1 && (
            <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              ×{s.Quantita}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function PneumaticiTable({ items, showUsura }: { items: PneumaticoFoglio[]; showUsura: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {["Pneumatico", "Misura", "Stagione", "Qtà", ...(showUsura ? ["Usura"] : [])].map((h) => (
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
          {items.map((p, i) => {
            const label = p.Titolo || [p.Marca, p.Modello].filter(Boolean).join(" ") || "—";
            const usura = Number(p.Usura ?? 0);
            return (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="px-2 py-2.5" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                  <span className="font-semibold">{label}</span>
                </td>
                <td className="px-2 py-2.5 font-mono text-xs" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                  {p.Misura || "—"}
                </td>
                <td className="px-2 py-2.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                  {p.Stagione || "—"}
                </td>
                <td className="px-2 py-2.5 text-center" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                  {p.Quantita ?? 1}
                </td>
                {showUsura && (
                  <td className="px-2 py-2.5">
                    {usura > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${usura}%`,
                              background: usura > 70 ? "#EF4444" : usura > 40 ? "#F59E0B" : "#22C55E",
                            }}
                          />
                        </div>
                        <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>{usura}%</span>
                      </div>
                    ) : <span style={{ color: "var(--text-muted)" }}>—</span>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
