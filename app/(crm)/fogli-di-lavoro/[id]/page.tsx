"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  doc, getDoc, updateDoc, serverTimestamp, type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  ArrowLeft, Printer, CheckCircle2, Car, User, MapPin, Clock, Pencil,
} from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import toast from "react-hot-toast";
import type { FoglioDiLavoro, FoglioStato, ServiziItem, Pneumatico } from "@/lib/types";

const statoVariant: Record<string, "brand" | "success" | "neutral"> = {
  Aperto:            "neutral",
  "In lavorazione":  "brand",
  Completato:        "success",
};

type ClienteInfo = { nome: string; email?: string; telefono?: string };
type VeicoloInfo = { targa: string; marca?: string; modello?: string; anno?: number; km?: number };
type SedeInfo    = { nome: string };

function fmtData(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
}

function fmtTime(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function euro(n: number | undefined | null) {
  if (n == null || n === 0) return null;
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

export default function FoglioLavoroDetailPage() {
  const params = useParams();
  const id     = params.id as string;

  const [foglio,      setFoglio]      = useState<FoglioDiLavoro | null>(null);
  const [clienteInfo, setClienteInfo] = useState<ClienteInfo | null>(null);
  const [veicoloInfo, setVeicoloInfo] = useState<VeicoloInfo | null>(null);
  const [sedeInfo,    setSedeInfo]    = useState<SedeInfo | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [savingStato, setSavingStato] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "Foglio_di_Lavoro", id));
        if (!snap.exists()) { toast.error("Foglio non trovato"); return; }
        const f = { id: snap.id, ...snap.data() } as FoglioDiLavoro;
        setFoglio(f);

        const [cSnap, vSnap, sSnap] = await Promise.all([
          f.Cliente ? getDoc(f.Cliente) : Promise.resolve(null),
          f.Veicolo ? getDoc(f.Veicolo) : Promise.resolve(null),
          f.Sede    ? getDoc(f.Sede)    : Promise.resolve(null),
        ]);

        if (cSnap?.exists()) {
          const d = cSnap.data();
          setClienteInfo({
            nome:     String(d.Ragione_Sociale || d.Nome || "—").trim(),
            email:    d.Email    ? String(d.Email)    : undefined,
            telefono: d.Telefono ? String(d.Telefono) : undefined,
          });
        }
        if (vSnap?.exists()) {
          const d = vSnap.data();
          setVeicoloInfo({
            targa:   String(d.Targa   ?? ""),
            marca:   d.Marca   ? String(d.Marca)   : undefined,
            modello: d.Modello ? String(d.Modello) : undefined,
            anno:    d.Anno    ? Number(d.Anno)    : undefined,
            km:      d.Km      ? Number(d.Km)      : undefined,
          });
        }
        if (sSnap?.exists()) {
          setSedeInfo({ nome: String(sSnap.data().Nome ?? "—") });
        }
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
      await updateDoc(doc(db, "Foglio_di_Lavoro", id), {
        Stato: nuovoStato,
        ...(nuovoStato === "Completato" ? { DataCompletamento: serverTimestamp() } : {}),
      });
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

  const dataTs = foglio.DataOra ?? foglio.Data_Creazione;

  // Servizi: solo quelli selezionati, divisi per tipo
  const tuttiServizi  = (foglio.Servizi ?? []) as ServiziItem[];
  const serviziSelezionati = tuttiServizi.filter((s) => s.Selected);
  const serviziPneu   = serviziSelezionati.filter((s) => s.Tipo === "Pneumatico");
  const serviziVeicolo = serviziSelezionati.filter((s) => s.Tipo === "Veicolo");

  const pneuMontati   = (foglio.Pneumatici_Montati  ?? []) as Pneumatico[];
  const pneuSmontati  = (foglio.Pneumatici_Smontati ?? []) as Pneumatico[];

  const foglioLabel = foglio.ID != null ? `#${foglio.ID}` : `#${id.slice(0, 6).toUpperCase()}`;

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
              {dataTs && (
                <span className="flex items-center gap-1">
                  <Clock size={12} style={{ color: "var(--text-muted)" }} />
                  {fmtData(dataTs)} {fmtTime(dataTs)}
                </span>
              )}
              {sedeInfo && (
                <span className="flex items-center gap-1">
                  <MapPin size={12} style={{ color: "var(--text-muted)" }} />
                  {sedeInfo.nome}
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
          {veicoloInfo ? (
            <div className="space-y-1 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
              <p className="text-xl font-bold font-mono" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                {veicoloInfo.targa}
              </p>
              <p style={{ color: "var(--text-secondary)" }}>
                {[veicoloInfo.marca, veicoloInfo.modello, veicoloInfo.anno].filter(Boolean).join(" ")}
              </p>
              {veicoloInfo.km != null && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Km: <span className="font-semibold">{veicoloInfo.km.toLocaleString("it-IT")}</span>
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
          {clienteInfo ? (
            <div className="space-y-1 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
              <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{clienteInfo.nome}</p>
              {clienteInfo.telefono && <p style={{ color: "var(--text-secondary)" }}>{clienteInfo.telefono}</p>}
              {clienteInfo.email    && <p style={{ color: "var(--text-secondary)" }}>{clienteInfo.email}</p>}
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

function ServiziList({ items }: { items: ServiziItem[] }) {
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

function PneumaticiTable({ items, showUsura }: { items: Pneumatico[]; showUsura: boolean }) {
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
