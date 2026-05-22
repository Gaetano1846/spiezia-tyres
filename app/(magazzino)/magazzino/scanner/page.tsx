"use client";

import { useState } from "react";
import {
  collection, collectionGroup, getDocs, getDoc, query, where,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { searchProdotti, stockTotale, formatMisura, type ProdottoHit } from "@/lib/algolia";
import { QrCode, Camera, Search, Car, Package, Loader2, AlertCircle } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Link from "next/link";
import type { Gabbia } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GabbiaMatch = {
  gabbiaId: string;
  posizione: string;   // gabbia.ID
  sedeName: string;
  quantita: number;
};

type VeicoloMatch = {
  clienteId: string;
  clienteNome: string;
  targa: string;
  marca?: string;
  modello?: string;
  anno?: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const stagioneBadge: Record<string, "brand" | "neutral" | "success"> = {
  Estive: "brand",
  Invernali: "neutral",
  "4-Stagioni": "success",
};

/** Cerca nelle gabbie quelle che contengono il prodotto con l'ID specificato (Algolia objectID). */
async function cercaInMagazzino(prodottoId: string): Promise<GabbiaMatch[]> {
  const snap = await getDocs(collection(db, "Magazzino"));
  const matches: GabbiaMatch[] = [];

  const sedeRefs = new Map<string, DocumentReference>();
  const gabbie: (Gabbia & { id: string })[] = snap.docs.map((d) => {
    const g = { id: d.id, ...d.data() } as Gabbia & { id: string };
    if (g.Sede) sedeRefs.set((g.Sede as DocumentReference).path, g.Sede as DocumentReference);
    return g;
  });

  // resolve sedi
  const sedeMap = new Map<string, string>();
  await Promise.all(
    [...sedeRefs.values()].map(async (ref) => {
      const s = await getDoc(ref);
      if (s.exists()) sedeMap.set(ref.path, String(s.data().Nome ?? "—"));
    }),
  );

  for (const g of gabbie) {
    for (const lotto of g.Prodotti ?? []) {
      if (lotto.Prodotto_Ref?.id === prodottoId) {
        matches.push({
          gabbiaId: g.id,
          posizione: g.ID ?? "—",
          sedeName: g.Sede ? (sedeMap.get((g.Sede as DocumentReference).path) ?? "—") : "—",
          quantita: lotto.Quantita ?? 0,
        });
      }
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ScannerPage() {
  const [tab, setTab] = useState<"scansiona" | "manuale">("scansiona");
  const [cameraAttiva, setCameraAttiva] = useState(false);

  // EAN / nome prodotto
  const [query_ean, setQueryEan]           = useState("");
  const [loadingEan, setLoadingEan]         = useState(false);
  const [prodottiEan, setProdottiEan]       = useState<ProdottoHit[]>([]);
  const [selectedProd, setSelectedProd]     = useState<ProdottoHit | null>(null);
  const [gabbieMatch, setGabbieMatch]       = useState<GabbiaMatch[]>([]);
  const [loadingGabbie, setLoadingGabbie]   = useState(false);
  const [eanNotFound, setEanNotFound]       = useState(false);

  // Targa
  const [targa, setTarga]                   = useState("");
  const [loadingTarga, setLoadingTarga]     = useState(false);
  const [veicoliMatch, setVeicoliMatch]     = useState<VeicoloMatch[]>([]);
  const [targaNotFound, setTargaNotFound]   = useState(false);

  // -------------------------------------------------------------------------
  // EAN search
  // -------------------------------------------------------------------------

  async function handleEanSearch() {
    const q = query_ean.trim();
    if (!q) return;
    setLoadingEan(true);
    setProdottiEan([]);
    setSelectedProd(null);
    setGabbieMatch([]);
    setEanNotFound(false);
    try {
      const result = await searchProdotti({ query: q, hitsPerPage: 8, soloDisponibili: false });
      if (result.hits.length === 0) {
        setEanNotFound(true);
      } else {
        setProdottiEan(result.hits);
      }
    } catch {
      setEanNotFound(true);
    } finally {
      setLoadingEan(false);
    }
  }

  async function handleSelectProdotto(p: ProdottoHit) {
    setSelectedProd(p);
    setProdottiEan([]);
    setLoadingGabbie(true);
    setGabbieMatch([]);
    try {
      const matches = await cercaInMagazzino(p.objectID);
      setGabbieMatch(matches);
    } finally {
      setLoadingGabbie(false);
    }
  }

  // -------------------------------------------------------------------------
  // Targa search
  // -------------------------------------------------------------------------

  async function handleTargaSearch() {
    const t = targa.trim().toUpperCase();
    if (!t) return;
    setLoadingTarga(true);
    setVeicoliMatch([]);
    setTargaNotFound(false);
    try {
      const snap = await getDocs(
        query(collectionGroup(db, "Veicolo"), where("Targa", "==", t)),
      );
      if (snap.empty) {
        setTargaNotFound(true);
        return;
      }
      const results: VeicoloMatch[] = await Promise.all(
        snap.docs.map(async (d) => {
          const vData = d.data();
          const clienteDoc = d.ref.parent.parent;
          let clienteNome = "—";
          if (clienteDoc) {
            const cSnap = await getDoc(clienteDoc);
            if (cSnap.exists()) {
              const cd = cSnap.data();
              clienteNome =
                String(cd.Azienda || "").trim() ||
                `${cd.Nome ?? ""} ${cd.Cognome ?? ""}`.trim() ||
                "—";
            }
          }
          return {
            clienteId:   clienteDoc?.id ?? "",
            clienteNome,
            targa:   String(vData.Targa ?? t),
            marca:   String(vData.Marca ?? ""),
            modello: String(vData.Modello ?? ""),
            anno:    Number(vData.Anno) || undefined,
          };
        }),
      );
      setVeicoliMatch(results);
    } catch {
      setTargaNotFound(true);
    } finally {
      setLoadingTarga(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
          Scanner
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
          Cerca un pneumatico o una targa
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
        {(["scansiona", "manuale"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors"
            style={
              tab === t
                ? { background: "#fff", color: "var(--text-primary)", boxShadow: "var(--shadow-sm)", fontFamily: "var(--font-montserrat)" }
                : { color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }
            }
          >
            {t === "scansiona" ? "Fotocamera" : "Ricerca manuale"}
          </button>
        ))}
      </div>

      {/* ── CAMERA TAB ─────────────────────────────────────────────────────── */}
      {tab === "scansiona" && (
        <Card padding="md">
          <div className="flex flex-col items-center gap-5">
            <div
              className="relative flex items-center justify-center rounded-2xl overflow-hidden"
              style={{
                width: 300,
                height: 300,
                background: cameraAttiva ? "#111" : "var(--bg-primary)",
                border: `3px solid ${cameraAttiva ? "var(--brand)" : "var(--border)"}`,
              }}
            >
              {!cameraAttiva ? (
                <div className="flex flex-col items-center gap-3">
                  <QrCode size={80} style={{ color: "var(--text-muted)" }} />
                  <p className="text-sm text-center px-6" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                    Attiva la fotocamera per scansionare un barcode EAN
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <QrCode size={80} className="animate-pulse" style={{ color: "var(--brand)" }} />
                  <p className="text-sm text-center" style={{ color: "#fff", fontFamily: "var(--font-montserrat)" }}>
                    Scansione in corso…
                  </p>
                </div>
              )}
              {cameraAttiva && (
                <>
                  <div className="absolute top-3 left-3 w-8 h-8 border-t-4 border-l-4 rounded-tl-lg" style={{ borderColor: "var(--brand)" }} />
                  <div className="absolute top-3 right-3 w-8 h-8 border-t-4 border-r-4 rounded-tr-lg" style={{ borderColor: "var(--brand)" }} />
                  <div className="absolute bottom-3 left-3 w-8 h-8 border-b-4 border-l-4 rounded-bl-lg" style={{ borderColor: "var(--brand)" }} />
                  <div className="absolute bottom-3 right-3 w-8 h-8 border-b-4 border-r-4 rounded-br-lg" style={{ borderColor: "var(--brand)" }} />
                </>
              )}
            </div>

            <button
              onClick={() => setCameraAttiva((v) => !v)}
              className="flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold"
              style={{
                background: cameraAttiva ? "#F3F4F6" : "var(--brand)",
                color: cameraAttiva ? "var(--text-primary)" : "#111",
                fontFamily: "var(--font-montserrat)",
              }}
            >
              <Camera size={16} />
              {cameraAttiva ? "Disattiva fotocamera" : "Attiva fotocamera"}
            </button>

            <p className="text-xs text-center" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              Integrazione barcode scanner in arrivo. Usa la ricerca manuale nel frattempo.
            </p>
          </div>
        </Card>
      )}

      {/* ── MANUALE TAB ────────────────────────────────────────────────────── */}
      {tab === "manuale" && (
        <div className="space-y-4">

          {/* EAN / nome prodotto */}
          <Card padding="md">
            <h2 className="text-sm font-bold mb-3" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
              EAN / Marca / Misura
            </h2>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
                <input
                  value={query_ean}
                  onChange={(e) => {
                    setQueryEan(e.target.value);
                    setProdottiEan([]);
                    setSelectedProd(null);
                    setGabbieMatch([]);
                    setEanNotFound(false);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleEanSearch()}
                  placeholder="es. 3528709768948 oppure Michelin 205/55 R16"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
                />
              </div>
              <button
                onClick={handleEanSearch}
                disabled={loadingEan || !query_ean.trim()}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center gap-2"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                {loadingEan ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                Cerca
              </button>
            </div>

            {/* Risultati Algolia */}
            {prodottiEan.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  Seleziona prodotto
                </p>
                {prodottiEan.map((p) => (
                  <button
                    key={p.objectID}
                    onClick={() => handleSelectProdotto(p)}
                    className="w-full text-left flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl transition-colors hover:bg-[#F1F4F8]"
                    style={{ border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }}
                  >
                    <div>
                      <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                        {p.Marca} {p.Modello}
                      </span>
                      <span className="ml-2 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                        {formatMisura(p)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant={stagioneBadge[p.Stagione] ?? "neutral"}>{p.Stagione}</Badge>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {stockTotale(p)} pz
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Not found */}
            {eanNotFound && (
              <div className="mt-4 flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                <AlertCircle size={15} style={{ color: "#EF4444" }} />
                Nessun prodotto trovato per &ldquo;{query_ean}&rdquo;.
              </div>
            )}

            {/* Prodotto selezionato */}
            {selectedProd && (
              <div className="mt-4 space-y-3">
                <div
                  className="rounded-xl p-3 flex items-center gap-3"
                  style={{ background: "#F0FDF4", border: "1px solid #BBF7D0" }}
                >
                  <Package size={18} style={{ color: "#10B981", flexShrink: 0 }} />
                  <div style={{ fontFamily: "var(--font-montserrat)" }}>
                    <p className="text-sm font-semibold" style={{ color: "#065F46" }}>
                      {selectedProd.Marca} {selectedProd.Modello} — {formatMisura(selectedProd)}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "#10B981" }}>
                      Stock totale: {stockTotale(selectedProd)} pz
                    </p>
                  </div>
                </div>

                {/* Gabbie */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                    Posizione in magazzino
                  </p>
                  {loadingGabbie ? (
                    <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                      <Loader2 size={14} className="animate-spin" /> Ricerca gabbie…
                    </div>
                  ) : gabbieMatch.length === 0 ? (
                    <p className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                      Prodotto non trovato in nessuna gabbia.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                        <thead>
                          <tr className="border-b text-left" style={{ borderColor: "var(--border)" }}>
                            {["Gabbia", "Sede", "Qtà", ""].map((h) => (
                              <th key={h} className="pb-2 pr-3 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {gabbieMatch.map((m, i) => (
                            <tr key={i} className="hover:bg-[#F9FAFB] transition-colors" style={{ borderBottom: "1px solid var(--border)" }}>
                              <td className="py-2.5 pr-3">
                                <span className="font-bold text-xs px-2 py-1 rounded-full" style={{ background: "#FEF3C7", color: "#92400E" }}>
                                  {m.posizione}
                                </span>
                              </td>
                              <td className="py-2.5 pr-3" style={{ color: "var(--text-secondary)" }}>{m.sedeName}</td>
                              <td className="py-2.5 pr-3 font-bold" style={{ color: "var(--text-primary)" }}>{m.quantita}</td>
                              <td className="py-2.5">
                                <Link
                                  href={`/magazzino/gabbie/${m.gabbiaId}`}
                                  className="text-xs font-semibold px-2.5 py-1.5 rounded-lg"
                                  style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}
                                >
                                  Apri
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* Targa */}
          <Card padding="md">
            <h2 className="text-sm font-bold mb-3" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
              Targa veicolo
            </h2>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Car size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
                <input
                  value={targa}
                  onChange={(e) => {
                    setTarga(e.target.value.toUpperCase());
                    setVeicoliMatch([]);
                    setTargaNotFound(false);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleTargaSearch()}
                  placeholder="es. AB123CD"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none font-mono uppercase"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
                />
              </div>
              <button
                onClick={handleTargaSearch}
                disabled={loadingTarga || !targa.trim()}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center gap-2"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                {loadingTarga ? <Loader2 size={15} className="animate-spin" /> : <Car size={15} />}
                Cerca
              </button>
            </div>

            {targaNotFound && (
              <div className="mt-4 flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                <AlertCircle size={15} style={{ color: "#EF4444" }} />
                Nessun veicolo trovato con targa <span className="font-mono font-bold">{targa}</span>.
              </div>
            )}

            {veicoliMatch.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                  <thead>
                    <tr className="border-b text-left" style={{ borderColor: "var(--border)" }}>
                      {["Targa", "Veicolo", "Anno", "Cliente", ""].map((h) => (
                        <th key={h} className="pb-2 pr-3 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {veicoliMatch.map((v, i) => (
                      <tr key={i} className="hover:bg-[#F9FAFB] transition-colors" style={{ borderBottom: "1px solid var(--border)" }}>
                        <td className="py-3 pr-3 font-mono font-bold text-xs" style={{ color: "var(--text-primary)" }}>{v.targa}</td>
                        <td className="py-3 pr-3 font-semibold" style={{ color: "var(--text-primary)" }}>
                          {v.marca} {v.modello}
                        </td>
                        <td className="py-3 pr-3" style={{ color: "var(--text-secondary)" }}>{v.anno ?? "—"}</td>
                        <td className="py-3 pr-3" style={{ color: "var(--text-secondary)" }}>{v.clienteNome}</td>
                        <td className="py-3">
                          {v.clienteId && (
                            <Link
                              href={`/clienti/${v.clienteId}`}
                              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg"
                              style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}
                            >
                              Scheda
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
