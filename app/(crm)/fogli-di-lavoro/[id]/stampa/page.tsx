"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import type { FoglioDiLavoro, Pneumatico } from "@/lib/types";
import { Loader2, Download, Printer } from "lucide-react";
import toast from "react-hot-toast";

function fmtDate(ts: Timestamp | null | undefined) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
}
function fmtTime(ts: Timestamp | null | undefined) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

export default function StampaFoglioPage() {
  const { id } = useParams<{ id: string }>();
  const [foglio, setFoglio] = useState<FoglioDiLavoro | null>(null);
  const [clienteNome, setClienteNome] = useState("—");
  const [clienteTel, setClienteTel] = useState("");
  const [veicoloLabel, setVeicoloLabel] = useState("");
  const [sedeNome, setSedeNome] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      const snap = await getDoc(doc(db, "Foglio_di_Lavoro", id));
      if (!snap.exists()) { setLoading(false); return; }
      const f = { id: snap.id, ...snap.data() } as FoglioDiLavoro;
      setFoglio(f);

      const data = f as Record<string, unknown>;

      // Existing PDF URL (generated previously)
      const existingUrl = (data.PDF ?? data.URL) as string | undefined;
      if (existingUrl) setPdfUrl(existingUrl);

      if (data.Cliente) {
        const cSnap = await getDoc(data.Cliente as Parameters<typeof getDoc>[0]);
        if (cSnap.exists()) {
          const c = cSnap.data() as Record<string, unknown>;
          setClienteNome((c.Azienda && c.Ragione_Sociale) ? String(c.Ragione_Sociale) : String(c.Nome ?? "")?.trim() || "—");
          setClienteTel(String(c.Telefono ?? ""));
        }
      }

      if (data.Veicolo) {
        const vSnap = await getDoc(data.Veicolo as Parameters<typeof getDoc>[0]);
        if (vSnap.exists()) {
          const v = vSnap.data() as Record<string, unknown>;
          setVeicoloLabel([v.Marca, v.Modello, v.Targa ? `(${v.Targa})` : ""].filter(Boolean).join(" "));
        }
      }

      if (data.Sede) {
        const sSnap = await getDoc(data.Sede as Parameters<typeof getDoc>[0]);
        if (sSnap.exists()) setSedeNome(String((sSnap.data() as Record<string, unknown>).Nome ?? ""));
      }

      setLoading(false);
    };
    fetch().catch(() => setLoading(false));
  }, [id]);

  async function generaPDF() {
    setGenerating(true);
    try {
      const element = document.getElementById("foglio-print-area");
      if (!element) throw new Error("Elemento non trovato");

      // Dynamic import per non appesantire il bundle iniziale
      const [html2canvas, { jsPDF }] = await Promise.all([
        import("html2canvas").then((m) => m.default),
        import("jspdf"),
      ]);

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth  = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgHeight  = (canvas.height * pageWidth) / canvas.width;

      // Gestione multi-pagina
      let y = 0;
      while (y < imgHeight) {
        if (y > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, -y, pageWidth, imgHeight);
        y += pageHeight;
      }

      const pdfBytes = pdf.output("arraybuffer");
      const fileName = `foglio_lavoro_${Date.now()}.pdf`;
      const storageRef = ref(storage, `foglidilavoro/${fileName}`);
      await uploadBytes(storageRef, new Uint8Array(pdfBytes), { contentType: "application/pdf" });
      const url = await getDownloadURL(storageRef);

      // Salva URL nel documento Firestore (come fa Flutter)
      await updateDoc(doc(db, "Foglio_di_Lavoro", id), { PDF: url, URL: url });

      setPdfUrl(url);
      window.open(url, "_blank");
      toast.success("PDF generato e salvato");
    } catch (err) {
      console.error(err);
      toast.error("Errore nella generazione del PDF");
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return (
    <div style={{ padding: 40, fontFamily: "Arial", display: "flex", alignItems: "center", gap: 12 }}>
      <Loader2 size={20} className="animate-spin" /> Caricamento…
    </div>
  );
  if (!foglio) return <div style={{ padding: 40, fontFamily: "Arial" }}>Foglio non trovato.</div>;

  const data = foglio as Record<string, unknown>;
  const montati  = (data.Pneumatici_Montati  as Pneumatico[] | undefined) ?? [];
  const smontati = (data.Pneumatici_Smontati as Pneumatico[] | undefined) ?? [];
  const servizi  = (data.Servizi as Array<Record<string, unknown>> | undefined) ?? [];
  const serviziFiltrati = servizi.filter((s) => s.Selected !== false);
  const note = data.Note as string | undefined;
  const oraInizio = data.Ora_Inizio as Timestamp | undefined;
  const oraFine   = data.Ora_Fine   as Timestamp | undefined;
  const dataTs    = (data.Data_Creazione ?? data.DataOra) as Timestamp | undefined;
  const numero    = data.Numero ?? `#${id.slice(0, 6).toUpperCase()}`;

  return (
    <>
      <style>{`
        @page { size: A4; margin: 18mm; }
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #111; color: #fff; padding: 7px 10px; font-size: 11px; text-align: left; }
        td { padding: 6px 10px; font-size: 11px; border-bottom: 1px solid #e5e7eb; }
        tr:nth-child(even) td { background: #fafafa; }
      `}</style>

      {/* Toolbar — visibile solo a schermo */}
      <div className="no-print" style={{ padding: "12px 20px", background: "#FFC803", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={generaPDF}
          disabled={generating}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 20px", background: "#111", color: "#fff", border: "none", borderRadius: 8, cursor: generating ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14, opacity: generating ? 0.7 : 1 }}
        >
          {generating ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Download size={15} />}
          {generating ? "Generazione…" : "Genera PDF"}
        </button>

        <button
          onClick={() => window.print()}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 18px", background: "rgba(0,0,0,0.12)", color: "#111", border: "1px solid rgba(0,0,0,0.2)", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}
        >
          <Printer size={15} /> Stampa diretta
        </button>

        {pdfUrl && (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 18px", background: "#fff", color: "#111", border: "1px solid rgba(0,0,0,0.2)", borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: "none" }}
          >
            <Download size={15} /> Apri PDF salvato
          </a>
        )}

        <button onClick={() => window.history.back()}
          style={{ marginLeft: "auto", padding: "8px 16px", background: "transparent", border: "1px solid #111", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
          ← Torna
        </button>
      </div>

      {/* Contenuto del foglio — catturato da html2canvas */}
      <div id="foglio-print-area" style={{ padding: "24px 32px", maxWidth: 760, margin: "0 auto", background: "#fff" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-lion.png" alt="Spiezia Tyres" style={{ width: 38, height: 38, objectFit: "contain" }} />
            <div>
              <div style={{ fontWeight: 900, fontSize: 15, letterSpacing: 1 }}>SPIEZIA TYRES S.P.A.</div>
              <div style={{ fontSize: 10, color: "#666" }}>Foglio di Lavoro</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{String(numero)}</div>
            <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>{fmtDate(dataTs)}</div>
            {sedeNome && <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>Sede: {sedeNome}</div>}
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "2px solid #FFC803", marginBottom: 20 }} />

        {/* Cliente e Veicolo */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
          <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 8 }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#888", marginBottom: 6 }}>Cliente</div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{clienteNome}</div>
            {clienteTel && <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>{clienteTel}</div>}
          </div>
          <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 8 }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#888", marginBottom: 6 }}>Veicolo</div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{veicoloLabel || "—"}</div>
            {(oraInizio || oraFine) && (
              <div style={{ fontSize: 10, color: "#666", marginTop: 4 }}>
                {oraInizio && `Inizio: ${fmtTime(oraInizio)}`}
                {oraInizio && oraFine && " · "}
                {oraFine && `Fine: ${fmtTime(oraFine)}`}
              </div>
            )}
          </div>
        </div>

        {/* Pneumatici montati */}
        {montati.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, color: "#444" }}>
              Pneumatici montati
            </div>
            <table>
              <thead>
                <tr><th>Marca</th><th>Modello</th><th>Misura</th><th>Stagione</th><th style={{ textAlign: "center" }}>Qtà</th></tr>
              </thead>
              <tbody>
                {montati.map((p, i) => (
                  <tr key={i}>
                    <td>{p.Marca || "—"}</td><td>{p.Modello || "—"}</td>
                    <td>{p.Misura || "—"}</td><td>{p.Stagione || "—"}</td>
                    <td style={{ textAlign: "center" }}>{p.Quantita ?? 4}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pneumatici smontati */}
        {smontati.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, color: "#444" }}>
              Pneumatici smontati
            </div>
            <table>
              <thead>
                <tr><th>Marca</th><th>Modello</th><th>Misura</th><th>Stagione</th><th style={{ textAlign: "center" }}>Qtà</th></tr>
              </thead>
              <tbody>
                {smontati.map((p, i) => (
                  <tr key={i}>
                    <td>{p.Marca || "—"}</td><td>{p.Modello || "—"}</td>
                    <td>{p.Misura || "—"}</td><td>{p.Stagione || "—"}</td>
                    <td style={{ textAlign: "center" }}>{p.Quantita ?? 4}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Servizi */}
        {serviziFiltrati.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, color: "#444" }}>Servizi</div>
            <table>
              <thead>
                <tr><th>Servizio</th><th>Tipo</th><th style={{ textAlign: "center" }}>Qtà</th></tr>
              </thead>
              <tbody>
                {serviziFiltrati.map((s, i) => (
                  <tr key={i}>
                    <td>{String(s.Nome ?? s.Titolo ?? "—")}</td>
                    <td>{String(s.Tipo ?? "—")}</td>
                    <td style={{ textAlign: "center" }}>{String(s.Quantita ?? 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Note */}
        {note && (
          <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 20, fontSize: 11 }}>
            <strong>Note:</strong> {note}
          </div>
        )}

        {/* Firme */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 32 }}>
          {["Firma Operatore", "Firma Cliente"].map((label) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ borderTop: "1px solid #111", paddingTop: 6, fontSize: 10, color: "#666" }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 32, fontSize: 9, color: "#aaa", textAlign: "center" }}>
          Spiezia Tyres S.P.A. · Documento generato il {new Date().toLocaleDateString("it-IT")}
        </div>
      </div>
    </>
  );
}
