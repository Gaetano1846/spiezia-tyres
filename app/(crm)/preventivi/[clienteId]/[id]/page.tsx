"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  doc, getDoc, updateDoc, serverTimestamp, Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  ArrowLeft, Download, CheckCircle2, XCircle, Car, User, FileText,
} from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import toast from "react-hot-toast";
import type { Preventivo } from "@/lib/types";

type ClienteInfo = { nome: string; email?: string; telefono?: string };
type VeicoloInfo = { targa: string; marca?: string; modello?: string; anno?: number; km?: number };

function euro(n: number | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function fmtTs(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
}

export default function PreventivoDetailPage() {
  const params     = useParams();
  const clienteId  = params.clienteId as string;
  const id         = params.id as string;

  const [preventivo,  setPreventivo]  = useState<Preventivo | null>(null);
  const [clienteInfo, setClienteInfo] = useState<ClienteInfo | null>(null);
  const [veicoloInfo, setVeicoloInfo] = useState<VeicoloInfo | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "Clienti", clienteId, "Preventivo", id));
        if (!snap.exists()) {
          toast.error("Preventivo non trovato");
          return;
        }
        const p = { id: snap.id, ...snap.data() } as Preventivo;
        setPreventivo(p);

        const cSnap = await getDoc(doc(db, "Clienti", clienteId));
        if (cSnap.exists()) {
          const d = cSnap.data();
          setClienteInfo({
            nome:     (d.Azienda && d.Ragione_Sociale) ? String(d.Ragione_Sociale) : (String(d.Nome ?? "").trim() || "—"),
            email:    String(d.Email ?? ""),
            telefono: String(d.Telefono ?? ""),
          });
        }

        if (p.Veicolo) {
          const vSnap = await getDoc(p.Veicolo);
          if (vSnap.exists()) {
            const vd = vSnap.data();
            setVeicoloInfo({
              targa:   String(vd.Targa ?? ""),
              marca:   String(vd.Marca ?? ""),
              modello: String(vd.Modello ?? ""),
              anno:    Number(vd.Anno ?? 0) || undefined,
              km:      Number(vd.Km ?? 0) || undefined,
            });
          }
        }
      } catch (e) {
        toast.error("Errore nel caricamento preventivo");
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [clienteId, id]);

  async function handleAccetta() {
    if (!preventivo || saving || preventivo.Accettato) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "Clienti", clienteId, "Preventivo", id), {
        Accettato: true,
        Data_Accettazione: serverTimestamp(),
      });
      setPreventivo({ ...preventivo, Accettato: true });
      toast.success("Preventivo segnato come accettato");
    } catch {
      toast.error("Errore aggiornamento");
    } finally {
      setSaving(false);
    }
  }

  async function handleRifiuta() {
    if (!preventivo || saving || !preventivo.Accettato) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "Clienti", clienteId, "Preventivo", id), {
        Accettato: false,
        Data_Accettazione: null,
      });
      setPreventivo({ ...preventivo, Accettato: false });
      toast.success("Preventivo rimesso in attesa");
    } catch {
      toast.error("Errore aggiornamento");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-5 animate-pulse">
        <div className="h-6 w-40 rounded-xl" style={{ background: "var(--bg-secondary)" }} />
        {[100, 140, 200, 80].map((h, i) => (
          <div key={i} className="rounded-2xl" style={{ height: h, background: "var(--bg-secondary)", border: "1px solid var(--border)" }} />
        ))}
      </div>
    );
  }

  if (!preventivo) {
    return (
      <div className="text-center py-20" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
        <p className="text-sm">Preventivo non trovato.</p>
        <Link href="/preventivi" className="text-sm font-semibold mt-3 inline-block" style={{ color: "var(--brand)" }}>
          ← Torna ai preventivi
        </Link>
      </div>
    );
  }

  const numero     = preventivo.ID != null ? `#${preventivo.ID}` : `#${id.slice(0, 6).toUpperCase()}`;
  const statoLabel = preventivo.Accettato ? "Accettato" : "In attesa";
  const pneumatici = preventivo.Pneumatici_Nuovi ?? [];

  const subtotale = pneumatici.reduce((s, p) => s + (p.PrezzoUnitario ?? 0) * (p.Quantita ?? 0), 0);
  const iva       = subtotale * 0.22;
  const totale    = subtotale + iva;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link
        href="/preventivi"
        className="inline-flex items-center gap-1.5 text-sm font-medium"
        style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
      >
        <ArrowLeft size={15} /> Preventivi
      </Link>

      {/* Header */}
      <Card>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                {numero}
              </h1>
              <Badge variant={preventivo.Accettato ? "success" : "neutral"}>{statoLabel}</Badge>
            </div>
            <div className="flex flex-col gap-0.5 text-sm" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
              {preventivo.Data
                ? <span>Data: <strong>{preventivo.Data}</strong></span>
                : <span>Creato il <strong>{fmtTs(preventivo.Data_Creazione)}</strong></span>
              }
              {preventivo.Data_Accettazione && (
                <span>Accettato il <strong>{fmtTs(preventivo.Data_Accettazione)}</strong></span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {preventivo.PDF_URL && (
              <a
                href={preventivo.PDF_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl"
                style={{ border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-montserrat)", background: "#fff" }}
              >
                <Download size={13} /> PDF
              </a>
            )}

            {!preventivo.Accettato && (
              <button
                onClick={handleAccetta}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl disabled:opacity-40"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                <CheckCircle2 size={13} /> Segna accettato
              </button>
            )}

            {preventivo.Accettato && (
              <button
                onClick={handleRifiuta}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl disabled:opacity-40"
                style={{ border: "1px solid #FEE2E2", background: "#FEF2F2", color: "#991B1B", fontFamily: "var(--font-montserrat)" }}
              >
                <XCircle size={13} /> Annulla accettazione
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Cliente + Veicolo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              {clienteInfo.email    && <p style={{ color: "var(--text-secondary)" }}>{clienteInfo.email}</p>}
              {clienteInfo.telefono && <p style={{ color: "var(--text-secondary)" }}>{clienteInfo.telefono}</p>}
              <Link href={`/clienti/${clienteId}`} className="text-xs font-semibold mt-2 inline-block" style={{ color: "#2563EB" }}>
                Scheda cliente →
              </Link>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>—</p>
          )}
        </Card>

        <Card padding="sm">
          <div className="flex items-center gap-2 mb-3">
            <Car size={14} style={{ color: "var(--text-muted)" }} />
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              Veicolo
            </p>
          </div>
          {veicoloInfo ? (
            <div className="space-y-1 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
              <p className="text-xl font-bold font-mono" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>
                {veicoloInfo.targa}
              </p>
              <p style={{ color: "var(--text-secondary)" }}>{veicoloInfo.marca} {veicoloInfo.modello} {veicoloInfo.anno}</p>
              {veicoloInfo.km && (
                <p style={{ color: "var(--text-muted)" }}>{veicoloInfo.km.toLocaleString("it-IT")} km</p>
              )}
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>Nessun veicolo associato</p>
          )}
        </Card>
      </div>

      {/* Pneumatici */}
      {pneumatici.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <FileText size={14} style={{ color: "var(--text-muted)" }} />
            <h2 className="font-bold text-base" style={{ fontFamily: "var(--font-poppins)" }}>Pneumatici</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Marca", "Modello", "Misura", "Qtà", "Prezzo unit.", "Totale"].map((h) => (
                    <th key={h} className="text-left pb-3 px-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pneumatici.map((p, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="px-2 py-3" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>{p.Marca ?? "—"}</td>
                    <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>{p.Modello ?? "—"}</td>
                    <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>{p.Misura ?? "—"}</td>
                    <td className="px-2 py-3 text-center" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>{p.Quantita ?? 1}</td>
                    <td className="px-2 py-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>{euro(p.PrezzoUnitario)}</td>
                    <td className="px-2 py-3 font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                      {euro((p.PrezzoUnitario ?? 0) * (p.Quantita ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Totale */}
      {pneumatici.length > 0 && (
        <Card>
          <div className="flex justify-end">
            <div className="w-full max-w-xs space-y-1.5 text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
              <div className="flex justify-between">
                <span style={{ color: "var(--text-secondary)" }}>Imponibile</span>
                <span style={{ color: "var(--text-primary)" }}>{euro(subtotale)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--text-secondary)" }}>IVA 22%</span>
                <span style={{ color: "var(--text-primary)" }}>{euro(iva)}</span>
              </div>
              <div className="flex justify-between pt-2 text-base font-bold" style={{ borderTop: "1px solid var(--border)", fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                <span>Totale</span>
                <span>{euro(totale)}</span>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
