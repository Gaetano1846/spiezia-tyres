"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
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
    (async () => {
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
            String(d.Ragione_Sociale || d.Azienda || d.Nome || d.Email || "—").trim() || "—"
          );
        }
      }
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading && ordine) {
      setTimeout(() => window.print(), 300);
    }
  }, [loading, ordine]);

  if (loading) return (
    <div style={{ padding: 60, fontFamily: "Arial", textAlign: "center", color: "#666" }}>
      Caricamento ordine…
    </div>
  );
  if (!ordine) return (
    <div style={{ padding: 60, fontFamily: "Arial", textAlign: "center", color: "#cc0000" }}>
      Ordine non trovato.
    </div>
  );

  const articoli = (ordine.Articoli ?? []) as Record<string, unknown>[];
  const normalized: ArticoloNorm[] = articoli.map((a) => ({
    nome:      String(a.Titolo ?? "Articolo"),
    marca:     String(a.Marca ?? ""),
    misura:    String(a.Misura ?? ""),
    prezzo:    Number(a.Prezzo ?? 0),
    pfu:       Number(a.PFU ?? 0),
    logistica: Number(a.Contributo_Logistico ?? 0),
    qty:       Number(a.Quantita ?? 1),
  }));

  const subtotale = normalized.reduce((s, a) => s + a.prezzo * a.qty, 0);
  const pfuTotale = normalized.reduce((s, a) => s + a.pfu * a.qty, 0);
  const logTotale = normalized.reduce((s, a) => s + a.logistica * a.qty, 0);
  const baseImpon = subtotale + pfuTotale + logTotale;
  const iva       = baseImpon * 0.22;
  const totale    = baseImpon + iva;

  const inFat = ordine.IndirizzoFatturazione as Record<string, string> | undefined;
  const inSpe = ordine.IndirizzoSpedizione   as Record<string, string> | undefined;

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        @page { size: A4; margin: 18mm 20mm; }
        html, body { margin: 0; padding: 0; background: #fff; font-family: Arial, Helvetica, sans-serif; color: #111; }
        @media screen {
          body { background: #f0f0f0; }
          #doc { background: #fff; max-width: 780px; margin: 20px auto; padding: 32px 40px; box-shadow: 0 2px 20px rgba(0,0,0,0.12); }
        }
        @media print {
          html, body { background: #fff !important; }
          #doc { padding: 0; box-shadow: none; max-width: 100%; margin: 0; }
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      {/* Toolbar — solo a schermo */}
      <div className="no-print" style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "#FFC803", padding: "10px 20px",
        display: "flex", alignItems: "center", gap: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.15)"
      }}>
        <button onClick={() => window.print()} style={{
          padding: "8px 22px", background: "#111", color: "#fff",
          border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14
        }}>
          Stampa / Salva PDF
        </button>
        <button onClick={() => window.close()} style={{
          padding: "8px 16px", background: "transparent",
          border: "1.5px solid #111", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14
        }}>
          ✕ Chiudi
        </button>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#111", opacity: 0.6 }}>
          Anteprima documento
        </span>
      </div>

      <div id="doc">
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-lion.png" alt="Spiezia Tyres" style={{ width: 44, height: 44, objectFit: "contain" }} />
            <div>
              <div style={{ fontWeight: 900, fontSize: 17, letterSpacing: 0.5 }}>SPIEZIA TYRES S.P.A.</div>
              <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>b2b@spieziatyres.it · +39 081 511 5011</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#111" }}>
              {ordine.Numero ?? `#${id.slice(0, 8).toUpperCase()}`}
            </div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
              {fmtDate(ordine.DataCreazione as Timestamp)}
            </div>
            <div style={{ marginTop: 6, display: "inline-block", padding: "3px 12px", background: "#FFC803", borderRadius: 20, fontWeight: 700, fontSize: 11 }}>
              {ordine.Stato}
            </div>
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "2.5px solid #FFC803", marginBottom: 24 }} />

        {/* Indirizzi */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, marginBottom: 28 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 9, textTransform: "uppercase", letterSpacing: 1.5, color: "#999", marginBottom: 6 }}>Cliente</div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{clienteNome}</div>
            {inFat && (
              <div style={{ fontSize: 11, color: "#444", lineHeight: 1.7, marginTop: 5 }}>
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
              <div style={{ fontWeight: 700, fontSize: 9, textTransform: "uppercase", letterSpacing: 1.5, color: "#999", marginBottom: 6 }}>Spedizione</div>
              <div style={{ fontSize: 11, color: "#444", lineHeight: 1.7 }}>
                {inSpe.Nome && <div style={{ fontWeight: 600 }}>{inSpe.Nome}</div>}
                {inSpe.Via && <div>{inSpe.Via}</div>}
                {(inSpe.CAP || inSpe.Citta) && <div>{[inSpe.CAP, inSpe.Citta, inSpe.Provincia].filter(Boolean).join(" ")}</div>}
              </div>
            </div>
          )}
        </div>

        {/* Tabella articoli */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 24 }}>
          <thead>
            <tr style={{ background: "#111", color: "#fff" }}>
              <th style={{ padding: "9px 12px", textAlign: "left", fontWeight: 700 }}>Prodotto</th>
              <th style={{ padding: "9px 8px", textAlign: "center", fontWeight: 700, width: 40 }}>Qtà</th>
              <th style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, width: 80 }}>Prezzo</th>
              <th style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, width: 60 }}>PFU</th>
              <th style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, width: 90 }}>Totale</th>
            </tr>
          </thead>
          <tbody>
            {normalized.map((a, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #e5e7eb", background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                <td style={{ padding: "9px 12px" }}>
                  <div style={{ fontWeight: 600 }}>{a.nome}</div>
                  {(a.marca || a.misura) && (
                    <div style={{ fontSize: 10, color: "#999", marginTop: 2 }}>{[a.marca, a.misura].filter(Boolean).join(" · ")}</div>
                  )}
                </td>
                <td style={{ padding: "9px 8px", textAlign: "center" }}>{a.qty}</td>
                <td style={{ padding: "9px 12px", textAlign: "right" }}>{fmt(a.prezzo)}</td>
                <td style={{ padding: "9px 12px", textAlign: "right", color: "#888" }}>{a.pfu > 0 ? fmt(a.pfu) : "—"}</td>
                <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700 }}>
                  {fmt((a.prezzo + a.pfu + a.logistica) * a.qty)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totali */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 36 }}>
          <div style={{ width: 280 }}>
            {[
              ["Subtotale",         fmt(subtotale)],
              ...(pfuTotale > 0    ? [["PFU",                   fmt(pfuTotale)]] : []),
              ...(logTotale > 0    ? [["Contributo logistico",  fmt(logTotale)]] : []),
              ["Base imponibile",  fmt(baseImpon)],
              ["IVA 22%",          fmt(iva)],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12, borderBottom: "1px solid #eee" }}>
                <span style={{ color: "#666" }}>{label}</span>
                <span>{value}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 4px", fontSize: 16, fontWeight: 900 }}>
              <span>TOTALE</span>
              <span>{fmt(totale)}</span>
            </div>
          </div>
        </div>

        {/* Note */}
        {ordine.Note && (
          <div style={{ fontSize: 11, color: "#555", borderTop: "1px solid #e5e7eb", paddingTop: 12, marginBottom: 20 }}>
            <strong>Note:</strong> {String(ordine.Note)}
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 36, paddingTop: 12, borderTop: "1px solid #eee", fontSize: 9, color: "#bbb", textAlign: "center" }}>
          Spiezia Tyres S.P.A. · b2b@spieziatyres.it · +39 081 511 5011 · Documento generato il {new Date().toLocaleDateString("it-IT")}
        </div>
      </div>
    </>
  );
}
