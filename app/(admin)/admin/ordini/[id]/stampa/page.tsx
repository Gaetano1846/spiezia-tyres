"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { doc, getDoc, collection, getDocs, orderBy, query } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import Image from "next/image";
import type { Ordine } from "@/lib/types";

function fmt(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}
function fmtDate(ts: Timestamp | null | undefined) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
}

type ArticoloNorm = {
  nome: string; marca: string; misura: string;
  prezzo: number; pfu: number; logistica: number; qty: number;
};

export default function StampaOrdinePage() {
  const { id } = useParams<{ id: string }>();
  const [ordine, setOrdine] = useState<Ordine | null>(null);
  const [clienteNome, setClienteNome] = useState("—");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const snap = await getDoc(doc(db, "Ordini", id));
      if (!snap.exists()) { setLoading(false); return; }
      const o = { id: snap.id, ...snap.data() } as Ordine;
      setOrdine(o);

      const ref = o.Cliente ?? o.Utente;
      if (ref) {
        const cSnap = await getDoc(ref as Parameters<typeof getDoc>[0]);
        if (cSnap.exists()) {
          const d = cSnap.data() as Record<string, unknown>;
          setClienteNome(
            (d.Azienda && d.Ragione_Sociale) ? String(d.Ragione_Sociale) :
            String(d.Nome ?? "")?.trim() || String(d.Email ?? "") || "—"
          );
        }
      }
      setLoading(false);
    };
    fetch().catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading && ordine) {
      setTimeout(() => window.print(), 400);
    }
  }, [loading, ordine]);

  if (loading) {
    return <div style={{ padding: 40, fontFamily: "Arial" }}>Caricamento ordine…</div>;
  }
  if (!ordine) {
    return <div style={{ padding: 40, fontFamily: "Arial" }}>Ordine non trovato.</div>;
  }

  const articoli = (ordine.Articoli ?? []) as Record<string, unknown>[];
  const normalized: ArticoloNorm[] = articoli.map((a) => ({
    nome:      String(a.Nome ?? a.Titolo ?? "Articolo"),
    marca:     String(a.Marca ?? ""),
    misura:    String(a.Misura ?? ""),
    prezzo:    Number(a.Prezzo ?? a.PrezzoUnitario ?? 0),
    pfu:       Number(a.PFU ?? 0),
    logistica: Number(a.contributoLogistico ?? a.ContributoLogistico ?? 0),
    qty:       Number(a.Quantita ?? a.Qty ?? 1),
  }));

  const subtotale   = normalized.reduce((s, a) => s + a.prezzo * a.qty, 0);
  const pfuTotale   = normalized.reduce((s, a) => s + a.pfu * a.qty, 0);
  const logTotale   = normalized.reduce((s, a) => s + a.logistica * a.qty, 0);
  const baseImpon   = subtotale + pfuTotale + logTotale;
  const iva         = baseImpon * 0.22;
  const totale      = baseImpon + iva;

  const inFat = ordine.IndirizzoFatturazione as Record<string, string> | undefined;
  const inSpe = ordine.IndirizzoSpedizione  as Record<string, string> | undefined;

  return (
    <>
      <style>{`
        @page { size: A4; margin: 20mm; }
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; }
      `}</style>

      {/* Bottone stampa visibile solo a schermo */}
      <div className="no-print" style={{ padding: "12px 20px", background: "#FFC803", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => window.print()}
          style={{ padding: "8px 20px", background: "#111", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
          Stampa / Salva PDF
        </button>
        <button onClick={() => window.history.back()}
          style={{ padding: "8px 16px", background: "transparent", border: "1px solid #111", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
          ← Torna
        </button>
      </div>

      <div style={{ padding: "24px 32px", maxWidth: 800, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <img src="/logo-lion.png" alt="Spiezia Tyres" style={{ width: 40, height: 40, objectFit: "contain" }} />
              <div>
                <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: 1 }}>SPIEZIA TYRES S.P.A.</div>
                <div style={{ fontSize: 10, color: "#555" }}>b2b@spieziatyres.it · +39 081 511 5011</div>
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#111" }}>
              {ordine.Numero ?? `#${id.slice(0, 8).toUpperCase()}`}
            </div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
              {fmtDate(ordine.DataCreazione as Timestamp)}
            </div>
            <div style={{ marginTop: 6, display: "inline-block", padding: "3px 10px", background: "#FFC803", borderRadius: 20, fontWeight: 700, fontSize: 11 }}>
              {ordine.Stato}
            </div>
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "2px solid #FFC803", marginBottom: 24 }} />

        {/* Indirizzi */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 28 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#888", marginBottom: 6 }}>Cliente</div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{clienteNome}</div>
            {inFat && (
              <div style={{ fontSize: 11, color: "#444", lineHeight: 1.6, marginTop: 4 }}>
                {inFat.Azienda && <div>{inFat.Azienda}</div>}
                {inFat.Via && <div>{inFat.Via}</div>}
                {(inFat.CAP || inFat.Citta) && <div>{[inFat.CAP, inFat.Citta, inFat.Provincia].filter(Boolean).join(" ")}</div>}
                {inFat.PEC && <div>{inFat.PEC}</div>}
                {inFat.CF && <div>C.F. {inFat.CF}</div>}
                {inFat.PIVA && <div>P.IVA {inFat.PIVA}</div>}
              </div>
            )}
          </div>
          {inSpe && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#888", marginBottom: 6 }}>Indirizzo spedizione</div>
              <div style={{ fontSize: 11, color: "#444", lineHeight: 1.6 }}>
                {inSpe.Via && <div>{inSpe.Via}</div>}
                {(inSpe.CAP || inSpe.Citta) && <div>{[inSpe.CAP, inSpe.Citta, inSpe.Provincia].filter(Boolean).join(" ")}</div>}
              </div>
            </div>
          )}
        </div>

        {/* Tabella articoli */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 20 }}>
          <thead>
            <tr style={{ background: "#111", color: "#fff" }}>
              <th style={{ padding: "8px 10px", textAlign: "left" }}>Prodotto</th>
              <th style={{ padding: "8px 10px", textAlign: "center" }}>Qtà</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Prezzo</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>PFU</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Totale</th>
            </tr>
          </thead>
          <tbody>
            {normalized.map((a, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #e5e7eb", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                <td style={{ padding: "8px 10px" }}>
                  <div style={{ fontWeight: 600 }}>{a.nome}</div>
                  {(a.marca || a.misura) && (
                    <div style={{ fontSize: 10, color: "#888" }}>{[a.marca, a.misura].filter(Boolean).join(" · ")}</div>
                  )}
                </td>
                <td style={{ padding: "8px 10px", textAlign: "center" }}>{a.qty}</td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmt(a.prezzo)}</td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>{a.pfu > 0 ? fmt(a.pfu) : "—"}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>{fmt((a.prezzo + a.pfu + a.logistica) * a.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totali */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 32 }}>
          <div style={{ width: 260 }}>
            {[
              ["Subtotale", fmt(subtotale)],
              ...(pfuTotale > 0 ? [["PFU", fmt(pfuTotale)]] : []),
              ...(logTotale > 0 ? [["Contributo logistico", fmt(logTotale)]] : []),
              ["Base imponibile", fmt(baseImpon)],
              ["IVA 22%", fmt(iva)],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, borderBottom: "1px solid #e5e7eb" }}>
                <span style={{ color: "#666" }}>{label}</span>
                <span>{value}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 15, fontWeight: 800, marginTop: 4 }}>
              <span>TOTALE</span>
              <span style={{ color: "#111" }}>{fmt(totale)}</span>
            </div>
          </div>
        </div>

        {/* Note */}
        {ordine.Note && (
          <div style={{ fontSize: 11, color: "#555", borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
            <strong>Note:</strong> {String(ordine.Note)}
          </div>
        )}

        <div style={{ marginTop: 40, fontSize: 9, color: "#aaa", textAlign: "center" }}>
          Spiezia Tyres S.P.A. · b2b@spieziatyres.it · +39 081 511 5011 · Documento generato il {new Date().toLocaleDateString("it-IT")}
        </div>
      </div>
    </>
  );
}
