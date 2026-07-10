"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { Package, ChevronRight, Plus, Trash2, QrCode, Search, X, Loader2 } from "lucide-react";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import toast from "react-hot-toast";
import type { GabbiaApi, LottoApi } from "@/lib/magazzinoDb";
import { searchProdotti, type ProdottoHit } from "@/lib/algolia";

function PosCoord({ label, value }: { label: string; value?: number | null }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl px-4 py-3"
      style={{ border: "1px solid #e5e7eb", background: "#f9fafb", minWidth: 64 }}
    >
      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
        {label}
      </span>
      <span className="text-2xl font-black mt-0.5" style={{ color: "#111", fontFamily: "var(--font-poppins)" }}>
        {value ?? 0}
      </span>
    </div>
  );
}

export default function GabbiaPage() {
  const params = useParams();
  const id = params.id as string;

  const [gabbia, setGabbia] = useState<GabbiaApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Modal aggiunta pneumatico
  const [showModal, setShowModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProdottoHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ProdottoHit | null>(null);
  const [qty, setQty] = useState(4);
  const [adding,       setAdding]       = useState(false);
  const [generatingQR, setGeneratingQR] = useState(false);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function reload() {
    const res = await fetch(`/api/magazzino/${id}`);
    if (!res.ok) throw new Error(String(res.status));
    const { gabbia: g } = await res.json();
    setGabbia(g);
  }

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        await reload();
      } catch (err) {
        console.error(err);
        toast.error("Errore nel caricamento della gabbia");
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Algolia/Meili search con debounce (catalogo prodotti, già su Postgres — Fase 2)
  useEffect(() => {
    if (!showModal) return;
    if (debRef.current) clearTimeout(debRef.current);
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    debRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchProdotti({ query: searchQuery, hitsPerPage: 12, soloDisponibili: false });
        setSearchResults(r.hits);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [searchQuery, showModal]);

  function openModal() {
    setSearchQuery("");
    setSearchResults([]);
    setSelected(null);
    setQty(4);
    setShowModal(true);
  }

  async function handleAdd() {
    if (!selected || !gabbia) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/magazzino/${id}/prodotti`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prodottoId: selected.objectID, quantita: qty }),
      });
      if (!res.ok) throw new Error(String(res.status));

      toast.success(`${qty} × ${selected.Marca} ${selected.Modello} aggiunti`);
      setShowModal(false);
      await reload();
    } catch (err) {
      console.error(err);
      toast.error("Errore nell'aggiunta");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(lotto: LottoApi) {
    if (!gabbia || !lotto.ProdottoId) return;
    try {
      const res = await fetch(`/api/magazzino/${id}/prodotti/${lotto.ProdottoId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      toast.success("Pneumatico rimosso");
      await reload();
    } catch (err) {
      console.error(err);
      toast.error("Errore nella rimozione");
    }
  }

  async function handleGeneraQR() {
    if (!gabbia || generatingQR) return;

    // Se il QR è già stato generato, aprilo direttamente (come nel vecchio
    // progetto FlutterFlow: launchURL del campo QR_code).
    if (gabbia.QrCode) {
      window.open(gabbia.QrCode, "_blank", "noopener");
      return;
    }

    setGeneratingQR(true);
    const toastId = toast.loading("Generazione QR…");
    try {
      // Genera QR + ZPL server-side (/api/magazzino/:id/qr, port di GenerateQR)
      // e scrive `qr_code` direttamente su Postgres — l'URL torna nella
      // risposta, nessuna lettura Firestore.
      const link = `https://newb2b.spieziatyres.it/Gabbia?gabbiaRef=${id}`;
      const res = await fetch(`/api/magazzino/${id}/qr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link }),
      });
      const data = await res.json().catch(() => null) as { QR_code_url?: string; error?: string } | null;
      if (!res.ok || !data?.QR_code_url) throw new Error(data?.error || `Errore ${res.status}`);

      toast.dismiss(toastId);
      setGabbia((g) => (g ? { ...g, QrCode: data.QR_code_url! } : g));
      window.open(data.QR_code_url, "_blank", "noopener");
      toast.success("QR generato");
    } catch {
      toast.dismiss(toastId);
      toast.error("Errore nella generazione del QR");
    } finally {
      setGeneratingQR(false);
    }
  }

  if (loading) {
    return (
      <div className="px-4 md:px-5 py-5 space-y-6">
        <div className="h-8 w-48 rounded-xl animate-pulse" style={{ background: "#f3f4f6" }} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: "#f3f4f6" }} />
          ))}
        </div>
        <div className="h-64 rounded-2xl animate-pulse" style={{ background: "#f3f4f6" }} />
      </div>
    );
  }

  if (notFound || !gabbia) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Package size={40} style={{ color: "#d1d5db" }} />
        <p className="text-lg font-bold" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
          Gabbia non trovata
        </p>
        <p className="text-sm" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
          L&apos;ID <span className="font-mono">{id}</span> non esiste nel magazzino.
        </p>
      </div>
    );
  }

  const prodotti = gabbia.Prodotti;
  const pneumaticiIN = gabbia.PneumaticiIn;

  return (
    <div className="px-4 md:px-5 py-5 space-y-6">

      {/* Modal aggiunta pneumatico */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div
            className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl overflow-hidden flex flex-col"
            style={{ background: "#fff", maxHeight: "90vh" }}
          >
            {/* Header modal */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h3 className="text-lg font-bold" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
                Aggiungi pneumatico
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-full hover:bg-gray-100">
                <X size={20} style={{ color: "#6b7280" }} />
              </button>
            </div>

            {/* Search */}
            <div className="px-5 pb-3">
              <div className="relative">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "#9ca3af" }} />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setSelected(null); }}
                  placeholder="Cerca per marca, misura, EAN…"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#111" }}
                />
                {searching && (
                  <Loader2 size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin" style={{ color: "#9ca3af" }} />
                )}
              </div>
            </div>

            {/* Risultati ricerca */}
            <div className="flex-1 overflow-y-auto px-5 pb-2" style={{ minHeight: 0 }}>
              {searchQuery && !searching && searchResults.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                  Nessun prodotto trovato
                </p>
              ) : (
                <div className="space-y-1.5">
                  {searchResults.map((hit) => {
                    const isSelected = selected?.objectID === hit.objectID;
                    const misura = `${hit.Larghezza}/${hit.Altezza} R${hit.Diametro}`;
                    return (
                      <button
                        key={hit.objectID}
                        onClick={() => setSelected(isSelected ? null : hit)}
                        className="w-full text-left px-3 py-3 rounded-xl transition-all"
                        style={{
                          background: isSelected ? "#FFF8DC" : "#f9fafb",
                          border: `2px solid ${isSelected ? "#FFC803" : "transparent"}`,
                          fontFamily: "var(--font-montserrat)",
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-bold" style={{ color: "#111", fontFamily: "var(--font-poppins)" }}>
                              {hit.Marca} {hit.Modello}
                            </p>
                            <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>
                              {misura} · {hit.Stagione}
                            </p>
                          </div>
                          {isSelected && (
                            <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#FFC803" }}>
                              <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                <path d="M1 4L3.5 6.5L9 1" stroke="#111" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Quantità + Conferma */}
            {selected && (
              <div
                className="px-5 py-4 border-t space-y-4"
                style={{ borderColor: "#e5e7eb", background: "#fafafa" }}
              >
                <div>
                  <p className="text-xs font-semibold mb-1" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
                    Selezionato: <span style={{ color: "#111" }}>{selected.Marca} {selected.Modello}</span>
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-semibold" style={{ color: "#374151", fontFamily: "var(--font-montserrat)" }}>Quantità</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setQty((q) => Math.max(1, q - 1))}
                      className="w-8 h-8 rounded-full border flex items-center justify-center font-bold text-lg"
                      style={{ border: "1px solid #e5e7eb", color: "#374151" }}
                    >−</button>
                    <span className="w-10 text-center font-black text-lg" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>{qty}</span>
                    <button
                      onClick={() => setQty((q) => q + 1)}
                      className="w-8 h-8 rounded-full border flex items-center justify-center font-bold text-lg"
                      style={{ border: "1px solid #e5e7eb", color: "#374151" }}
                    >+</button>
                  </div>
                </div>
                <button
                  onClick={handleAdd}
                  disabled={adding}
                  className="w-full py-3 rounded-full text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
                  style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
                >
                  {adding && <Loader2 size={15} className="animate-spin" />}
                  Aggiungi {qty} pz
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div>
        <nav
          className="flex items-center gap-1.5 text-xs mb-3"
          style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}
        >
          <a href="/magazzino" style={{ color: "#6b7280" }}>Magazzino</a>
          <ChevronRight size={12} />
          <span style={{ color: "#111", fontWeight: 600 }}>Gabbia {gabbia.Codice || gabbia.id}</span>
        </nav>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2">
              <QrCode size={20} style={{ color: "#FFC803" }} />
              <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
                Gabbia {gabbia.Codice || gabbia.id}
              </h1>
            </div>
            <p className="text-sm mt-0.5" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
              {gabbia.SedeNome}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleGeneraQR}
              disabled={generatingQR}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: "#f3f4f6", color: "#111", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)" }}
              title="Scarica QR code della gabbia"
            >
              {generatingQR ? <Loader2 size={15} className="animate-spin" /> : <QrCode size={15} />}
              QR
            </button>
            <button
              onClick={openModal}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold transition-opacity hover:opacity-90"
              style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
            >
              <Plus size={15} /> <span className="hidden xs:inline">Aggiungi </span>pneumatico
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Pezzi stoccati"
          value={gabbia.PzTotali}
          sub="quantità totale"
          icon={<Package size={22} />}
          accent="#FFC803"
        />
        <StatCard
          label="Tipi prodotto"
          value={prodotti.length}
          sub="righe distinte"
          icon={<Package size={22} />}
          accent="#249689"
        />
        <StatCard
          label="Pneu. IN"
          value={pneumaticiIN.length}
          sub="riferimenti diretti"
          icon={<Package size={22} />}
          accent="#EE8B60"
        />
      </div>

      {/* Coordinate */}
      <div
        className="rounded-2xl p-4"
        style={{ background: "#fff", border: "1px solid #e5e7eb" }}
      >
        <p
          className="text-xs font-bold uppercase tracking-widest mb-3"
          style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}
        >
          Posizione fisica
        </p>
        <div className="flex gap-3">
          <PosCoord label="X" value={gabbia.X} />
          <PosCoord label="Y" value={gabbia.Y} />
          <PosCoord label="Z" value={gabbia.Z} />
        </div>
      </div>

      {/* Prodotti table */}
      <Card padding="md">
        <h2
          className="text-base font-bold mb-4"
          style={{ fontFamily: "var(--font-poppins)", color: "#111" }}
        >
          Pneumatici in gabbia
        </h2>

        {prodotti.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Package size={32} style={{ color: "#d1d5db" }} />
            <p className="text-sm" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
              Nessun pneumatico stoccato in questa gabbia
            </p>
            <button
              onClick={openModal}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold"
              style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
            >
              <Plus size={13} /> Aggiungi pneumatico
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div
              className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest px-3 pb-2"
              style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)", borderBottom: "1px solid #f3f4f6" }}
            >
              <span>Prodotto</span>
              <span>Qtà</span>
            </div>

            {prodotti.map((lotto, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[#FFFDF0] transition-colors gap-3 flex-wrap"
                style={{ background: i % 2 === 0 ? "#f9fafb" : "#fff" }}
              >
                {/* Prodotto */}
                <div className="flex-1 min-w-0" style={{ minWidth: 0 }}>
                  {lotto.Marca || lotto.Modello ? (
                    <>
                      <p className="text-sm font-bold truncate" style={{ color: "#111", fontFamily: "var(--font-poppins)" }}>
                        {lotto.Marca} {lotto.Modello}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
                        {lotto.Misura}{lotto.Stagione ? ` · ${lotto.Stagione}` : ""}
                        {" · "}
                        <span style={{ color: (lotto.StockSede ?? 0) > 0 ? "#059669" : "#dc2626" }}>
                          stock sede: {lotto.StockSede ?? 0}
                        </span>
                      </p>
                    </>
                  ) : (
                    <span className="font-mono text-xs" style={{ color: "#9ca3af" }}>
                      {lotto.ProdottoId || "—"}
                    </span>
                  )}
                </div>
                {/* Quantità + Rimuovi */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span
                    className="text-sm font-bold whitespace-nowrap"
                    style={{ color: "#374151", fontFamily: "var(--font-montserrat)" }}
                  >
                    {lotto.Quantita ?? 0} pz
                  </span>
                  <button
                    onClick={() => handleRemove(lotto)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors hover:bg-red-100 whitespace-nowrap"
                    style={{ background: "#FEE2E2", color: "#991B1B", border: "1px solid #FECACA" }}
                  >
                    <Trash2 size={11} /> Rimuovi
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Pneumatici_IN (refs diretti) */}
      {pneumaticiIN.length > 0 && (
        <Card padding="md">
          <h2
            className="text-base font-bold mb-4"
            style={{ fontFamily: "var(--font-poppins)", color: "#111" }}
          >
            Riferimenti diretti
          </h2>
          <div className="space-y-1.5">
            {pneumaticiIN.map((prodottoId, i) => (
              <div
                key={i}
                className="flex items-center px-3 py-2 rounded-xl text-sm"
                style={{ background: "#f9fafb", fontFamily: "var(--font-montserrat)" }}
              >
                <Package size={13} style={{ color: "#9ca3af", marginRight: 8 }} />
                <span className="font-mono text-xs" style={{ color: "#374151" }}>
                  {prodottoId}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
