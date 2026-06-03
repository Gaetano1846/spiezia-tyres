"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import {
  doc, getDoc, updateDoc, arrayRemove,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Package, ChevronRight, Plus, Trash2, QrCode, Search, X, Loader2 } from "lucide-react";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import toast from "react-hot-toast";
import type { Gabbia, LottoMagazzino } from "@/lib/types";
import { searchProdotti, type ProdottoHit } from "@/lib/algolia";

type GabbiaUI = Gabbia & { sedeName: string };

function PosCoord({ label, value }: { label: string; value?: number }) {
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

  const [gabbia, setGabbia] = useState<GabbiaUI | null>(null);
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

  const [prodottiCache, setProdottiCache] = useState<Record<string, {
    Marca: string; Modello: string; misura: string; Stagione?: string; stockSede: number;
  }>>({});

  function stockFieldForSede(sedeName: string): string {
    const n = sedeName.toLowerCase();
    if (n.includes("nola 2") || n.includes("nola2")) return "Stock_Nola_2";
    if (n.includes("nola")) return "Stock_Nola";
    if (n.includes("volla")) return "Stock_Volla";
    if (n.includes("roma")) return "Stock_Roma";
    if (n.includes("portici")) return "Stock_Portici";
    if (n.includes("ocp")) return "Stock_OCP";
    return "Stock_Nola";
  }

  async function reload() {
    const snap = await getDoc(doc(db, "Magazzino", id));
    if (!snap.exists()) return;
    const data = { id: snap.id, ...snap.data() } as Gabbia;
    let sedeName = "—";
    if (data.Sede) {
      const sedeSnap = await getDoc(data.Sede as DocumentReference);
      if (sedeSnap.exists()) sedeName = (sedeSnap.data().Nome as string) ?? "—";
    }
    setGabbia({ ...data, sedeName });
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

  // Risolve i Prodotto_Ref quando cambia la gabbia
  useEffect(() => {
    if (!gabbia?.Prodotti?.length) { setProdottiCache({}); return; }
    const uniqueRefs = [
      ...new Map(
        gabbia.Prodotti.filter((l) => l.Prodotto_Ref).map((l) => [l.Prodotto_Ref.id, l.Prodotto_Ref])
      ).values(),
    ] as DocumentReference[];
    const field = stockFieldForSede(gabbia.sedeName);
    Promise.all(uniqueRefs.map((ref) => getDoc(ref))).then((snaps) => {
      const cache: typeof prodottiCache = {};
      for (const snap of snaps) {
        if (snap.exists()) {
          const d = snap.data() as Record<string, unknown>;
          cache[snap.id] = {
            Marca: (d.Marca as string) ?? "?",
            Modello: (d.Modello as string) ?? "?",
            misura: `${d.Larghezza ?? "?"}/${d.Altezza ?? "?"} R${d.Diametro ?? "?"}`,
            Stagione: d.Stagione as string | undefined,
            stockSede: ((d[field] as number) ?? 0),
          };
        }
      }
      setProdottiCache(cache);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gabbia]);

  // Algolia search con debounce
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
      const gabbiaRef = doc(db, "Magazzino", id);
      const prodottoRef = doc(db, "Prodotti", selected.objectID);

      // Leggi stato attuale per gestire merge/incremento quantità
      const snap = await getDoc(gabbiaRef);
      const data = snap.data() as Record<string, unknown>;
      const prodotti: Array<Record<string, unknown>> = ((data.Prodotti as unknown[]) ?? []).map((p) => p as Record<string, unknown>);

      // Trova se il prodotto è già presente
      const existingIdx = prodotti.findIndex((p) => {
        const ref = p.Prodotto_Ref as DocumentReference | undefined;
        return ref?.id === selected.objectID;
      });

      if (existingIdx !== -1) {
        // Incrementa quantità esistente
        prodotti[existingIdx] = {
          ...prodotti[existingIdx],
          Quantita: ((prodotti[existingIdx].Quantita as number) ?? 0) + qty,
        };
        await updateDoc(gabbiaRef, { Prodotti: prodotti });
      } else {
        // Nuovo lotto: arrayUnion su entrambi
        const { arrayUnion } = await import("firebase/firestore");
        await updateDoc(gabbiaRef, {
          Prodotti: arrayUnion({ Quantita: qty, Prodotto_Ref: prodottoRef }),
          Pneumatici_IN: arrayUnion(prodottoRef),
        });
      }

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

  async function handleRemove(lotto: LottoMagazzino) {
    if (!gabbia) return;
    const gabbiaRef = doc(db, "Magazzino", id);
    try {
      const snap = await getDoc(gabbiaRef);
      const data = snap.data() as Record<string, unknown>;
      const prodotti: Array<Record<string, unknown>> = ((data.Prodotti as unknown[]) ?? []).map((p) => p as Record<string, unknown>);

      const idx = prodotti.findIndex((p) => {
        const ref = p.Prodotto_Ref as DocumentReference | undefined;
        return ref?.id === lotto.Prodotto_Ref?.id;
      });

      if (idx === -1) return;

      const updatedProdotti = [...prodotti];
      updatedProdotti.splice(idx, 1);

      const updates: Record<string, unknown> = { Prodotti: updatedProdotti };

      // Se era l'ultimo lotto di questo prodotto, rimuovi anche da Pneumatici_IN
      const hasOther = updatedProdotti.some((p) => {
        const ref = p.Prodotto_Ref as DocumentReference | undefined;
        return ref?.id === lotto.Prodotto_Ref?.id;
      });
      if (!hasOther && lotto.Prodotto_Ref) {
        updates.Pneumatici_IN = arrayRemove(lotto.Prodotto_Ref);
      }

      await updateDoc(gabbiaRef, updates);
      toast.success("Pneumatico rimosso");
      await reload();
    } catch (err) {
      console.error(err);
      toast.error("Errore nella rimozione");
    }
  }

  async function handleGeneraQR() {
    if (!gabbia || generatingQR) return;
    setGeneratingQR(true);
    const toastId = toast.loading("Generazione QR…");
    try {
      const res = await fetch("https://europe-west3-crm-3iuocs.cloudfunctions.net/GenerateQR", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id:       id,
          posizione: gabbia.ID ?? id,
          sede:     gabbia.sedeName,
          x: gabbia.X, y: gabbia.Y, z: gabbia.Z,
        }),
      });
      if (!res.ok) throw new Error(`CF ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `QR_Gabbia_${gabbia.ID ?? id}.png`;
      a.click();
      URL.revokeObjectURL(url);
      toast.dismiss(toastId);
      toast.success("QR scaricato");
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

  const prodotti = gabbia.Prodotti ?? [];
  const pzTotali = prodotti.reduce((sum, l) => sum + (l.Quantita ?? 0), 0);
  const pneumaticiIN = gabbia.Pneumatici_IN ?? [];

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
          <span style={{ color: "#111", fontWeight: 600 }}>Gabbia {gabbia.ID || gabbia.id}</span>
        </nav>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2">
              <QrCode size={20} style={{ color: "#FFC803" }} />
              <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
                Gabbia {gabbia.ID || gabbia.id}
              </h1>
            </div>
            <p className="text-sm mt-0.5" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
              {gabbia.sedeName}
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
          value={pzTotali}
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

            {prodotti.map((lotto, i) => {
              const pid = lotto.Prodotto_Ref?.id;
              const info = pid ? prodottiCache[pid] : undefined;
              return (
                <div
                  key={i}
                  className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[#FFFDF0] transition-colors gap-3 flex-wrap"
                  style={{ background: i % 2 === 0 ? "#f9fafb" : "#fff" }}
                >
                  {/* Prodotto */}
                  <div className="flex-1 min-w-0" style={{ minWidth: 0 }}>
                    {info ? (
                      <>
                        <p className="text-sm font-bold truncate" style={{ color: "#111", fontFamily: "var(--font-poppins)" }}>
                          {info.Marca} {info.Modello}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
                          {info.misura}{info.Stagione ? ` · ${info.Stagione}` : ""}
                          {" · "}
                          <span style={{ color: info.stockSede > 0 ? "#059669" : "#dc2626" }}>
                            stock sede: {info.stockSede}
                          </span>
                        </p>
                      </>
                    ) : (
                      <span className="font-mono text-xs animate-pulse" style={{ color: "#9ca3af" }}>
                        {pid ?? "—"}
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
              );
            })}
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
            {pneumaticiIN.map((ref, i) => (
              <div
                key={i}
                className="flex items-center px-3 py-2 rounded-xl text-sm"
                style={{ background: "#f9fafb", fontFamily: "var(--font-montserrat)" }}
              >
                <Package size={13} style={{ color: "#9ca3af", marginRight: 8 }} />
                <span className="font-mono text-xs" style={{ color: "#374151" }}>
                  {ref.id}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
