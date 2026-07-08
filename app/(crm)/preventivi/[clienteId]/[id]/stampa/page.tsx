"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { Loader2, Download, Printer } from "lucide-react";
import toast from "react-hot-toast";
import type { PreventivoApi } from "@/lib/preventiviDb";

function euro(n: number | undefined | null): string {
  if (n == null) return "—";
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function fmtIso(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
}

function getServizi(p: PreventivoApi) {
  return p.Servizi.map((raw) => {
    const s = raw as Record<string, unknown>;
    return {
      titolo:   (s.Titolo as string) || (s.titolo as string) || "Servizio",
      prezzo:   Number(s.Prezzo ?? s.prezzoUnitario ?? 0),
      quantita: Number(s.Quantita ?? s.quantita ?? 1),
    };
  }).filter((s) => s.prezzo > 0 || s.titolo !== "Servizio");
}

export default function StampaPreventivoPage() {
  const { clienteId, id } = useParams<{ clienteId: string; id: string }>();

  const [loading,    setLoading]    = useState(true);
  const [generating, setGenerating] = useState(false);
  const [pdfUrl,     setPdfUrl]     = useState<string | null>(null);
  const [preventivo, setPreventivo] = useState<PreventivoApi | null>(null);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/preventivi/${clienteId}/${id}`);
        if (!res.ok) { setLoading(false); return; }
        const { preventivo: p } = (await res.json()) as { preventivo: PreventivoApi };
        setPreventivo(p);
        if (p.PdfUrl) setPdfUrl(p.PdfUrl);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [clienteId, id]);

  async function generaPDF() {
    setGenerating(true);
    try {
      const element = document.getElementById("preventivo-print-area");
      if (!element) throw new Error("Elemento non trovato");

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

      const imgData  = canvas.toDataURL("image/png");
      const pdf      = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW    = pdf.internal.pageSize.getWidth();
      const pageH    = pdf.internal.pageSize.getHeight();
      const imgH     = (canvas.height * pageW) / canvas.width;

      let y = 0;
      while (y < imgH) {
        if (y > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, -y, pageW, imgH);
        y += pageH;
      }

      const pdfBytes = pdf.output("arraybuffer");
      const fileName = `preventivo_${id}_${Date.now()}.pdf`;
      const storageRef = ref(storage, `Ordini_PDF/preventivi/${fileName}`);
      await uploadBytes(storageRef, new Uint8Array(pdfBytes), { contentType: "application/pdf" });
      const url = await getDownloadURL(storageRef);

      // Salva l'URL su Postgres — il bridge lo propaga a Firestore (PDF_URL)
      // per il CRM FlutterFlow legacy.
      const patchRes = await fetch(`/api/preventivi/${clienteId}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfUrl: url }),
      });
      if (!patchRes.ok) throw new Error(String(patchRes.status));

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

  if (loading) {
    return (
      <div style={{ padding: 40, fontFamily: "Arial", display: "flex", alignItems: "center", gap: 12 }}>
        <Loader2 size={20} className="animate-spin" /> Caricamento…
      </div>
    );
  }
  if (!preventivo) return <div style={{ padding: 40, fontFamily: "Arial" }}>Preventivo non trovato.</div>;

  const numero = preventivo.Numero != null ? `#${preventivo.Numero}` : `#${id.slice(0, 6).toUpperCase()}`;
  const stato = preventivo.Stato ?? (preventivo.Accettato ? "Accettato" : "In attesa");
  const dataDoc = preventivo.Data ?? fmtIso(preventivo.DataCreazione);
  const scadenza = preventivo.DataScadenza ? fmtIso(preventivo.DataScadenza) : "";
  const articoli = preventivo.Articoli;
  const servizi = getServizi(preventivo);
  const note = preventivo.Note ?? "";

  const totArt = articoli.reduce((s, a) => s + ((a.PrezzoUnitario ?? 0) + (a.PFU ?? 0)) * (a.Quantita ?? 0), 0);
  const totSrv = servizi.reduce((s, sv) => s + sv.prezzo * sv.quantita, 0);
  const imponibile = totArt + totSrv;
  const iva = imponibile * 0.22;
  const totale = imponibile + iva;

  return (
    <>
      <style>{`
        @page { size: A4; margin: 15mm; }
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

      {/* ── Toolbar ── */}
      <div
        className="no-print"
        style={{ padding: "12px 20px", background: "#FFC803", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
      >
        <button
          onClick={generaPDF}
          disabled={generating}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 20px", background: "#111", color: "#fff",
            border: "none", borderRadius: 8, cursor: generating ? "not-allowed" : "pointer",
            fontWeight: 700, fontSize: 14, opacity: generating ? 0.7 : 1,
          }}
        >
          {generating ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Download size={15} />}
          {generating ? "Generazione…" : "Genera PDF"}
        </button>

        <button
          onClick={() => window.print()}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 18px", background: "rgba(0,0,0,0.12)", color: "#111",
            border: "1px solid rgba(0,0,0,0.2)", borderRadius: 8, cursor: "pointer",
            fontWeight: 600, fontSize: 14,
          }}
        >
          <Printer size={15} /> Stampa diretta
        </button>

        {pdfUrl && (
          <a
            href={pdfUrl} target="_blank" rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 18px", background: "#fff", color: "#111",
              border: "1px solid rgba(0,0,0,0.2)", borderRadius: 8,
              fontWeight: 600, fontSize: 14, textDecoration: "none",
            }}
          >
            <Download size={15} /> Apri PDF salvato
          </a>
        )}

        <button
          onClick={() => window.history.back()}
          style={{
            marginLeft: "auto", padding: "8px 16px", background: "transparent",
            border: "1px solid #111", borderRadius: 8, cursor: "pointer",
            fontWeight: 600, fontSize: 14,
          }}
        >
          ← Torna
        </button>
      </div>

      {/* ── Contenuto preventivo ── */}
      <div id="preventivo-print-area" style={{ padding: "24px 32px", maxWidth: 760, margin: "0 auto", background: "#fff" }}>

        {/* Header azienda + titolo */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-spiezia.png"
              alt="Spiezia Tyres"
              style={{ height: 40, marginBottom: 8, objectFit: "contain" }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
            <p style={{ fontSize: 11, color: "#6b7280", margin: 0 }}>Spiezia Tyres S.p.A.</p>
            <p style={{ fontSize: 11, color: "#6b7280", margin: 0 }}>P.IVA: 00000000000</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: "-0.5px" }}>PREVENTIVO</p>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#FFC803", margin: "4px 0 0" }}>{numero}</p>
            <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>Data: {dataDoc}</p>
            {scadenza && <p style={{ fontSize: 11, color: "#EF4444" }}>Scadenza: {scadenza}</p>}
            <span style={{
              display: "inline-block", marginTop: 6,
              padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
              background: stato === "Accettato" ? "#D1FAE5" : stato === "Rifiutato" ? "#FEE2E2" : "#FEF3C7",
              color: stato === "Accettato" ? "#065F46" : stato === "Rifiutato" ? "#991B1B" : "#92400E",
            }}>
              {stato}
            </span>
          </div>
        </div>

        <hr style={{ borderColor: "#e5e7eb", margin: "0 0 16px" }} />

        {/* Cliente + Veicolo */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          <div style={{ padding: "12px 16px", background: "#F9FAFB", borderRadius: 8 }}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#9CA3AF", margin: "0 0 8px" }}>Cliente</p>
            <p style={{ fontWeight: 700, fontSize: 13, margin: "0 0 4px" }}>{preventivo.ClienteNome}</p>
            {preventivo.ClienteCodiceFiscale && <p style={{ fontSize: 11, color: "#6b7280", margin: "2px 0" }}>CF: {preventivo.ClienteCodiceFiscale}</p>}
            {preventivo.ClientePartitaIva   && <p style={{ fontSize: 11, color: "#6b7280", margin: "2px 0" }}>P.IVA: {preventivo.ClientePartitaIva}</p>}
            {preventivo.ClienteTelefono     && <p style={{ fontSize: 11, color: "#6b7280", margin: "2px 0" }}>Tel: {preventivo.ClienteTelefono}</p>}
            {preventivo.ClienteEmail        && <p style={{ fontSize: 11, color: "#6b7280", margin: "2px 0" }}>{preventivo.ClienteEmail}</p>}
          </div>
          {(preventivo.VeicoloTarga || preventivo.VeicoloMarca) && (
            <div style={{ padding: "12px 16px", background: "#F9FAFB", borderRadius: 8 }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#9CA3AF", margin: "0 0 8px" }}>Veicolo</p>
              {preventivo.VeicoloTarga && <p style={{ fontWeight: 800, fontSize: 18, letterSpacing: "0.1em", margin: "0 0 4px" }}>{preventivo.VeicoloTarga}</p>}
              <p style={{ fontSize: 11, color: "#6b7280", margin: 0 }}>
                {[preventivo.VeicoloMarca, preventivo.VeicoloModello, preventivo.VeicoloAnno ? `(${preventivo.VeicoloAnno})` : ""].filter(Boolean).join(" ")}
              </p>
            </div>
          )}
        </div>

        {/* Pneumatici */}
        {articoli.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#374151", margin: "0 0 8px" }}>
              Pneumatici
            </p>
            <table>
              <thead>
                <tr>
                  {["Marca", "Modello", "Misura", "Qtà", "Prezzo unit.", "PFU", "Totale"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {articoli.map((a, i) => {
                  const tot = ((a.PrezzoUnitario ?? 0) + (a.PFU ?? 0)) * (a.Quantita ?? 0);
                  return (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{a.Marca ?? "—"}</td>
                      <td>{a.Modello ?? "—"}</td>
                      <td style={{ fontFamily: "monospace" }}>{a.Misura ?? "—"}</td>
                      <td style={{ textAlign: "center" }}>{a.Quantita}</td>
                      <td>{euro(a.PrezzoUnitario)}</td>
                      <td>{(a.PFU ?? 0) > 0 ? euro(a.PFU) : "—"}</td>
                      <td style={{ fontWeight: 700 }}>{euro(tot)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Servizi */}
        {servizi.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#374151", margin: "0 0 8px" }}>
              Servizi
            </p>
            <table>
              <thead>
                <tr>
                  {["Descrizione", "Qtà", "Prezzo unit.", "Totale"].map((h) => <th key={h}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {servizi.map((s, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{s.titolo}</td>
                    <td style={{ textAlign: "center" }}>{s.quantita}</td>
                    <td>{euro(s.prezzo)}</td>
                    <td style={{ fontWeight: 700 }}>{euro(s.prezzo * s.quantita)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Note */}
        {note && (
          <div style={{ marginBottom: 16, padding: "12px 16px", background: "#FFFBEB", borderRadius: 8, border: "1px solid #FDE68A" }}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#92400E", margin: "0 0 6px" }}>Note</p>
            <p style={{ fontSize: 11, color: "#374151", margin: 0, whiteSpace: "pre-wrap" }}>{note}</p>
          </div>
        )}

        {/* Totali */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
          <div style={{ width: 260 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12 }}>
              <span style={{ color: "#6b7280" }}>Imponibile</span>
              <span>{euro(imponibile)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12 }}>
              <span style={{ color: "#6b7280" }}>IVA 22%</span>
              <span>{euro(iva)}</span>
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between", padding: "10px 0 6px",
              borderTop: "2px solid #111", fontSize: 15, fontWeight: 800,
            }}>
              <span>TOTALE</span>
              <span>{euro(totale)}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid #e5e7eb", textAlign: "center" }}>
          <p style={{ fontSize: 10, color: "#9CA3AF", margin: 0 }}>
            Spiezia Tyres S.p.A. — Questo preventivo ha validità 30 giorni dalla data di emissione.
          </p>
        </div>
      </div>
    </>
  );
}
