"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Search, X, SlidersHorizontal, ChevronLeft, ChevronRight, ChevronDown, Minus, Plus, ShoppingCart, Snowflake, Sun, Wind, ZoomIn } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCart } from "@/components/layout/CartProvider";
import { useAuth } from "@/components/layout/AuthProvider";
import toast from "react-hot-toast";
import {
  searchProdotti,
  prezzoPerRuolo,
  stockTotale,
  formatMisura,
  pfuEffettivo,
  type ProdottoHit,
} from "@/lib/algolia";
import { CONTRIBUTO_LOGISTICO_UNIT } from "@/lib/cart";

type Stagione = "Estive" | "Invernali" | "4-Stagioni";

const STAGIONE_BTN: Record<Stagione, { active: string; text: string }> = {
  Estive:       { active: "#FFC803", text: "#111" },
  Invernali:    { active: "#2563EB", text: "#fff" },
  "4-Stagioni": { active: "#16A34A", text: "#fff" },
};

function StagioneIcon({ stagione }: { stagione: string }) {
  if (stagione === "Invernali")
    return <Snowflake size={16} style={{ color: "#2563EB" }} />;
  if (stagione === "4-Stagioni")
    return <Wind size={16} style={{ color: "#16A34A" }} />;
  return <Sun size={16} style={{ color: "#EAB308" }} />;
}

function euro(n: number | undefined | null) {
  return (n ?? 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function StockPill({ value, color }: { value: number; color: string }) {
  const label = value > 20 ? "20+" : String(value);
  return (
    <span
      className="inline-flex items-center justify-center w-10 h-7 rounded-lg text-xs font-bold"
      style={{ background: color, color: "#111", fontFamily: "var(--font-montserrat)" }}
    >
      {label}
    </span>
  );
}

export default function ProdottiPage() {
  const { add } = useCart();
  const { user } = useAuth();
  const searchParams = useSearchParams();

  // Filtri
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [misuraRapida, setMisuraRapida] = useState("");
  const [largezza, setLargezza] = useState("");
  const [altezza, setAltezza] = useState("");
  const [diametro, setDiametro] = useState("");
  const [stagioni, setStagioni] = useState<Stagione[]>(() => {
    const s = searchParams.get("stagione");
    return s ? (s.split(",") as Stagione[]) : [];
  });
  const [marche, setMarche] = useState<string[]>(() => {
    const m = searchParams.get("marca");
    return m ? m.split(",").filter(Boolean) : [];
  });
  const [categoria, setCategoria] = useState(searchParams.get("categoria") ?? "");
  const [showFiltri, setShowFiltri] = useState(false);
  const [marcheList, setMarcheList] = useState<string[]>([]);
  const [marcaSearch, setMarcaSearch] = useState("");

  // Risultati
  const [hits, setHits] = useState<ProdottoHit[]>([]);
  const [nbHits, setNbHits] = useState(0);
  const [nbPages, setNbPages] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"default" | "prezzo_asc" | "prezzo_desc" | "misura_asc">("default");

  // Quantità per prodotto
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  // Modal foto prodotto
  const [fotoModal, setFotoModal] = useState<ProdottoHit | null>(null);

  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Carica lista marche da Algolia facets; se non configurate come facets nel dashboard,
    // cade silenziosamente e la lista viene popolata dai risultati di ricerca.
    searchProdotti({ withFacets: true, hitsPerPage: 1, soloDisponibili: false })
      .then((r) => {
        if (r.facets?.Marca) setMarcheList(Object.keys(r.facets.Marca).sort());
      })
      .catch(console.warn);
  }, []);

  const doSearch = useCallback(async (pg: number) => {
    setLoading(true);
    setQuantities({});
    try {
      const r = await searchProdotti({
        query: search,
        largezza: largezza || undefined,
        altezza:  altezza  || undefined,
        diametro: diametro || undefined,
        stagioni,
        marche,
        categoria: categoria || undefined,
        soloDisponibili: true,
        page: pg,
        hitsPerPage: 50,
      });

      setNbHits(r.nbHits);
      setNbPages(r.nbPages);
      setPage(r.page);

      // Arricchisci con dati Firestore (prezzi, stock, PFU)
      const firestoreDocs = await Promise.all(
        r.hits.map((hit) => getDoc(doc(db, "Prodotti", hit.objectID)))
      );
      const enriched: ProdottoHit[] = r.hits.map((hit, i) => {
        const fsDoc = firestoreDocs[i];
        if (!fsDoc.exists()) return hit;
        const fsData = fsDoc.data() as Record<string, unknown>;
        const merged: Record<string, unknown> = { ...hit };
        for (const [k, v] of Object.entries(fsData)) {
          if (v !== null && v !== undefined) merged[k] = v;
        }
        return merged as ProdottoHit;
      });

      setHits(enriched);
    } catch {
      toast.error("Errore nel caricamento prodotti");
    } finally {
      setLoading(false);
    }
  }, [search, largezza, altezza, diametro, stagioni, marche, categoria]);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => doSearch(0), 300);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, largezza, altezza, diametro, stagioni, marche, categoria]);

  function handleMisuraRapida(v: string) {
    setMisuraRapida(v);
    const m = v.trim().match(/^(\d{3})\s*\/\s*(\d{2,3})\s*[Rr]\s*(\d{2})$/);
    if (m) { setLargezza(m[1]); setAltezza(m[2]); setDiametro(m[3]); }
  }

  function getQty(id: string) { return quantities[id] ?? 4; }
  function changeQty(id: string, delta: number, max: number) {
    setQuantities((p) => ({ ...p, [id]: Math.max(1, Math.min((p[id] ?? 4) + delta, max)) }));
  }

  function handleAdd(hit: ProdottoHit) {
    const prezzo = prezzoPerRuolo(hit, user?.Ruolo);
    const pfu = pfuEffettivo(hit);
    const stock = stockTotale(hit);
    const qty = getQty(hit.objectID);
    add({ id: hit.objectID, marca: hit.Marca, modello: hit.Modello,
          misura: formatMisura(hit), stagione: hit.Stagione,
          prezzo, pfu, stockMax: stock, quantita: qty });
    toast.success(`${qty} × ${hit.Marca} ${hit.Modello} aggiunto`);
    setQuantities((p) => ({ ...p, [hit.objectID]: 4 }));
  }

  function azzera() {
    setSearch(""); setMisuraRapida(""); setLargezza(""); setAltezza("");
    setDiametro(""); setStagioni([]); setMarche([]); setMarcaSearch(""); setCategoria("");
  }

  const sortedHits = useMemo(() => {
    if (sortBy === "default") return hits;
    return [...hits].sort((a, b) => {
      const pa = prezzoPerRuolo(a, user?.Ruolo);
      const pb = prezzoPerRuolo(b, user?.Ruolo);
      if (sortBy === "prezzo_asc")  return pa - pb;
      if (sortBy === "prezzo_desc") return pb - pa;
      if (sortBy === "misura_asc") {
        const ma = `${a.Larghezza}/${a.Altezza}R${a.Diametro}`;
        const mb = `${b.Larghezza}/${b.Altezza}R${b.Diametro}`;
        return ma.localeCompare(mb);
      }
      return 0;
    });
  }, [hits, sortBy, user?.Ruolo]);

  const CATEGORIE = [
    { label: "Pneumatici",    value: "" },
    { label: "Cerchi",        value: "Categoria_Prodotti/Cerchi Autocarro" },
    { label: "Camere D'Aria", value: "Categoria_Prodotti/Camere D Aria" },
  ];

  const isPneumatici = categoria === "";
  const isCerchi     = categoria.includes("Cerchi");
  const isCamere     = categoria.includes("Camere");

  const activeFilters = [
    ...(isPneumatici && largezza  ? [`L:${largezza}`]  : []),
    ...(isPneumatici && altezza   ? [`A:${altezza}`]   : []),
    ...((isPneumatici || isCerchi || isCamere) && diametro ? [`R${diametro}`] : []),
    ...(isPneumatici ? stagioni : []),
    ...marche,
    ...(categoria ? [CATEGORIE.find((c) => c.value === categoria)?.label ?? categoria] : []),
  ];

  function handleSetCategoria(value: string) {
    setCategoria(value);
    if (value !== "") {
      // Reset pneumatici-only filters when switching to Cerchi / Camere
      setMisuraRapida(""); setLargezza(""); setAltezza(""); setStagioni([]);
    }
    // Diametro is shared between all categories — never reset it on category switch
    setPage(0);
  }

  return (
    <div className="px-5 py-5 space-y-4">

      {/* ── Ricerca Avanzata ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold" style={{ color: "#374151", fontFamily: "var(--font-montserrat)" }}>
          Ricerca Avanzata:
        </span>
        {CATEGORIE.map((c) => {
          const active = categoria === c.value;
          return (
            <button
              key={c.label}
              onClick={() => handleSetCategoria(c.value)}
              className="px-4 py-1.5 rounded-full text-xs font-semibold transition-colors"
              style={{
                background: active ? "#FFFBEB" : "transparent",
                border: `1.5px solid #FFC803`,
                color: "#111",
                fontWeight: active ? 700 : 600,
                fontFamily: "var(--font-montserrat)",
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* ── Search + Filtri ── */}
      <div className="rounded-2xl overflow-hidden"
        style={{ background: "#fff", border: "1px solid #e5e7eb", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>

        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "#9ca3af" }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca marca, modello, misura…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#111" }} />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X size={13} style={{ color: "#9ca3af" }} />
              </button>
            )}
          </div>
          <button onClick={() => setShowFiltri((v) => !v)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors flex-shrink-0"
            style={{ background: showFiltri ? "#FFC803" : "#f9fafb", border: "1px solid #e5e7eb", color: "#111", fontFamily: "var(--font-montserrat)" }}>
            <SlidersHorizontal size={15} />
            Filtri
            {activeFilters.length > 0 && (
              <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                style={{ background: "#111", color: "#FFC803" }}>{activeFilters.length}</span>
            )}
            <ChevronDown size={14} style={{ transform: showFiltri ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </button>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-3 py-2.5 rounded-xl text-xs outline-none flex-shrink-0"
            style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#111" }}
          >
            <option value="default">Ordine default</option>
            <option value="prezzo_asc">Prezzo ↑</option>
            <option value="prezzo_desc">Prezzo ↓</option>
            <option value="misura_asc">Misura A-Z</option>
          </select>
          <span className="text-sm flex-shrink-0" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "…" : `${nbHits.toLocaleString("it-IT")} prodotti`}
          </span>
        </div>

        {showFiltri && (
          <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: "#f3f4f6" }}>

            {/* ── Pneumatici: layout completo ── */}
            {isPneumatici && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>Misura rapida</label>
                  <input value={misuraRapida} onChange={(e) => handleMisuraRapida(e.target.value)}
                    placeholder="es. 205/55 R16" className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#111" }} />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>Larghezza</label>
                  <input type="number" value={largezza} onChange={(e) => setLargezza(e.target.value)}
                    placeholder="es. 205" className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#111" }} />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>Altezza</label>
                  <input type="number" value={altezza} onChange={(e) => setAltezza(e.target.value)}
                    placeholder="es. 55" className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#111" }} />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>Diametro</label>
                  <select value={diametro} onChange={(e) => setDiametro(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#111" }}>
                    <option value="">Tutti</option>
                    {[13,14,15,16,17,18,19,20,21,22].map((d) => <option key={d} value={d}>R{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>Stagione</label>
                  <div className="flex flex-col gap-1">
                    {(["Estive","Invernali","4-Stagioni"] as Stagione[]).map((s) => {
                      const active = stagioni.includes(s);
                      return (
                        <button key={s} onClick={() => setStagioni((p) => p.includes(s) ? p.filter((x) => x !== s) : [...p, s])}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors text-left"
                          style={{ background: active ? STAGIONE_BTN[s].active : "#f9fafb", color: active ? STAGIONE_BTN[s].text : "#374151", border: `1px solid ${active ? STAGIONE_BTN[s].active : "#e5e7eb"}`, fontFamily: "var(--font-montserrat)" }}>
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {marcheList.length > 0 && (
                  <div className="md:col-span-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>Marca</label>
                    <input value={marcaSearch} onChange={(e) => setMarcaSearch(e.target.value)}
                      placeholder="Cerca marca..." className="w-full mb-2 px-3 py-1.5 rounded-xl text-xs outline-none"
                      style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#111" }} />
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                      {marcheList.filter((m) => m.toLowerCase().includes(marcaSearch.toLowerCase())).map((m) => {
                        const active = marche.includes(m);
                        return (
                          <button key={m} onClick={() => setMarche((p) => p.includes(m) ? p.filter((x) => x !== m) : [...p, m])}
                            className="px-3 py-1 rounded-full text-xs font-semibold transition-colors"
                            style={{ background: active ? "#FFC803" : "#f9fafb", color: active ? "#111" : "#374151", border: `1px solid ${active ? "#FFC803" : "#e5e7eb"}`, fontFamily: "var(--font-montserrat)" }}>
                            {m}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Cerchi / Camere D'Aria: solo Diametro + Marca ── */}
            {(isCerchi || isCamere) && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>Diametro</label>
                  <select value={diametro} onChange={(e) => setDiametro(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#111" }}>
                    <option value="">Tutti</option>
                    {[13,14,15,16,17,18,19,20,21,22].map((d) => <option key={d} value={d}>R{d}</option>)}
                  </select>
                </div>
                {marcheList.length > 0 && (
                  <div className="md:col-span-3">
                    <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>Marca</label>
                    <input value={marcaSearch} onChange={(e) => setMarcaSearch(e.target.value)}
                      placeholder="Cerca marca..." className="w-full mb-2 px-3 py-1.5 rounded-xl text-xs outline-none"
                      style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#111" }} />
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                      {marcheList.filter((m) => m.toLowerCase().includes(marcaSearch.toLowerCase())).map((m) => {
                        const active = marche.includes(m);
                        return (
                          <button key={m} onClick={() => setMarche((p) => p.includes(m) ? p.filter((x) => x !== m) : [...p, m])}
                            className="px-3 py-1 rounded-full text-xs font-semibold transition-colors"
                            style={{ background: active ? "#FFC803" : "#f9fafb", color: active ? "#111" : "#374151", border: `1px solid ${active ? "#FFC803" : "#e5e7eb"}`, fontFamily: "var(--font-montserrat)" }}>
                            {m}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeFilters.length > 0 && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {activeFilters.map((f) => (
                  <span key={f} className="px-2.5 py-1 rounded-full text-xs font-semibold"
                    style={{ background: "#FFF8DC", color: "#111", border: "1px solid #FFC803", fontFamily: "var(--font-montserrat)" }}>{f}</span>
                ))}
                <button onClick={azzera} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
                  style={{ background: "#fee2e2", color: "#ef4444", fontFamily: "var(--font-montserrat)" }}>
                  <X size={11} /> Azzera
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Lista prodotti (stile Flutter: riga orizzontale per prodotto) ── */}
      {loading ? (
        <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #e5e7eb" }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "#f3f4f6" }}>
              <div className="w-16 h-8 rounded-lg animate-pulse" style={{ background: "#f3f4f6" }} />
              <div className="flex-1 h-4 rounded animate-pulse" style={{ background: "#f3f4f6" }} />
              <div className="w-24 h-8 rounded-xl animate-pulse" style={{ background: "#f3f4f6" }} />
            </div>
          ))}
        </div>
      ) : sortedHits.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <Search size={48} style={{ color: "#d1d5db" }} />
          <p className="text-base font-semibold" style={{ color: "#374151", fontFamily: "var(--font-poppins)" }}>Nessun prodotto trovato</p>
          <p className="text-sm" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>Prova a modificare i filtri</p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #e5e7eb" }}>
            {/* Intestazione colonne — stile Flutter: header scuro */}
            <div className="hidden xl:grid px-4 py-2.5 text-[9px] font-bold uppercase tracking-wider"
              style={{
                gridTemplateColumns: "110px 1fr 28px 68px 56px 80px 44px 50px 44px 50px 88px 100px 40px",
                background: "#111",
                borderBottom: "1px solid #333",
                color: "#fff",
                fontFamily: "var(--font-montserrat)",
                gap: "8px",
              }}>
              <span>Marca</span>
              <span>Prodotto</span>
              <span className="text-center">S.</span>
              <span className="text-right">Prezzo</span>
              <span className="text-right">PFU</span>
              <span className="text-right">P. Finito</span>
              <span className="text-center">Nola</span>
              <span className="text-center">Napoli</span>
              <span className="text-center">Roma</span>
              <span className="text-center">48/72</span>
              <span className="text-center">Qtà</span>
              <span></span>
              <span className="text-center">Foto</span>
            </div>

            {/* Righe prodotto */}
            {sortedHits.map((hit, idx) => {
              const prezzo = prezzoPerRuolo(hit, user?.Ruolo);
              const pfu = pfuEffettivo(hit);
              const prezzoFinito = parseFloat(((prezzo + CONTRIBUTO_LOGISTICO_UNIT + pfu) * 1.22).toFixed(2));
              const stockNola   = (hit.Stock_Nola ?? 0) + (hit.Stock_Nola_2 ?? 0);
              const stockNapoli = (hit.Stock_Volla ?? 0) + (hit.Stock_Portici ?? 0) + (hit.Stock_OCP ?? 0);
              const stockRoma   = hit.Stock_Roma ?? 0;
              const stockT24    = hit.Stock_T24 ?? 0;
              const stock = stockTotale(hit);
              const qty = getQty(hit.objectID);
              const esaurito = stock === 0;
              const senzaPrezzo = prezzo === 0;

              return (
                <div
                  key={hit.objectID}
                  className="flex xl:grid items-center gap-2 px-4 py-2.5 transition-colors hover:bg-[#FFFDF0]"
                  style={{
                    gridTemplateColumns: "110px 1fr 28px 68px 56px 80px 44px 50px 44px 50px 88px 100px 40px",
                    borderBottom: idx < sortedHits.length - 1 ? "1px solid #f3f4f6" : "none",
                    opacity: esaurito ? 0.5 : 1,
                    gap: "8px",
                    background: senzaPrezzo ? "rgba(249,250,251,0.6)" : undefined,
                  }}
                >
                  {/* Marca */}
                  <div className="hidden xl:block">
                    {hit.Immagine ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={hit.Immagine} alt={hit.Marca}
                        className="h-8 max-w-[100px] object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <span className="text-xs font-bold uppercase" style={{ color: "#374151", fontFamily: "var(--font-montserrat)" }}>
                        {hit.Marca}
                      </span>
                    )}
                  </div>

                  {/* Prodotto */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold uppercase xl:hidden" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                      {hit.Marca}
                    </p>
                    <p className="text-sm font-semibold truncate" style={{ color: "#111", fontFamily: "var(--font-poppins)" }}>
                      {hit.Modello}
                    </p>
                    <p className="text-xs" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
                      {formatMisura(hit)}
                      {hit.Indice_Carico && hit.Indice_Velocita
                        ? ` ${hit.Indice_Carico}${hit.Indice_Velocita}` : ""}
                    </p>
                    {/* Prezzo finito visibile solo su mobile (colonne nascoste su xl) */}
                    {senzaPrezzo ? (
                      <p className="text-xs font-semibold xl:hidden mt-0.5" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                        Prezzo su richiesta
                      </p>
                    ) : (
                      <p className="text-sm font-black xl:hidden mt-0.5" style={{ color: "#111", fontFamily: "var(--font-poppins)" }}>
                        {euro(prezzoFinito)}
                        <span className="text-[10px] font-normal ml-1" style={{ color: "#9ca3af" }}>IVA incl.</span>
                      </p>
                    )}
                  </div>

                  {/* Stagione icon */}
                  <div className="hidden xl:flex items-center justify-center">
                    <StagioneIcon stagione={hit.Stagione} />
                  </div>

                  {/* Prezzo netto */}
                  <div className="hidden xl:block text-right">
                    <p className="text-xs font-semibold" style={{ color: senzaPrezzo ? "#9ca3af" : "#374151", fontFamily: "var(--font-poppins)" }}>
                      {senzaPrezzo ? "N/D" : euro(prezzo)}
                    </p>
                  </div>

                  {/* PFU */}
                  <div className="hidden xl:block text-right">
                    <p className="text-xs" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
                      {euro(pfu)}
                    </p>
                  </div>

                  {/* Prezzo Finito (contributo logistico + IVA 22% inclusi) */}
                  <div className="hidden xl:block text-right">
                    <p className="text-sm font-black" style={{ color: senzaPrezzo ? "#9ca3af" : "#111", fontFamily: "var(--font-poppins)" }}>
                      {senzaPrezzo ? "N/D" : euro(prezzoFinito)}
                    </p>
                  </div>

                  {/* Stock Nola */}
                  <div className="hidden xl:flex justify-center">
                    <StockPill value={stockNola} color="rgba(238,139,96,0.85)" />
                  </div>

                  {/* Stock Napoli (Volla + Portici + OCP) */}
                  <div className="hidden xl:flex justify-center">
                    <StockPill value={stockNapoli} color="rgba(238,139,96,0.85)" />
                  </div>

                  {/* Stock Roma */}
                  <div className="hidden xl:flex justify-center">
                    <StockPill value={stockRoma} color="rgba(255,200,3,0.75)" />
                  </div>

                  {/* Stock T24 dropship 48/72h */}
                  <div className="hidden xl:flex justify-center">
                    <StockPill value={stockT24} color="rgba(99,179,237,0.75)" />
                  </div>

                  {/* Quantità — cella sempre presente per mantenere l'allineamento della griglia */}
                  <div className="flex items-center justify-center" style={{ visibility: (!esaurito && !senzaPrezzo) ? "visible" : "hidden" }}>
                    <div className="flex items-center rounded-xl overflow-hidden"
                      style={{ border: "1px solid #e5e7eb" }}>
                      <button onClick={() => changeQty(hit.objectID, -1, stock)}
                        disabled={qty <= 1}
                        className="w-7 h-8 flex items-center justify-center hover:bg-gray-100 transition-colors disabled:opacity-40">
                        <Minus size={11} />
                      </button>
                      <span className="w-8 text-center text-sm font-bold" style={{ color: "#111", fontFamily: "var(--font-montserrat)" }}>
                        {qty}
                      </span>
                      <button onClick={() => changeQty(hit.objectID, +1, stock)}
                        disabled={qty >= stock}
                        className="w-7 h-8 flex items-center justify-center hover:bg-gray-100 transition-colors disabled:opacity-40">
                        <Plus size={11} />
                      </button>
                    </div>
                  </div>

                  {/* Aggiungi / Su richiesta / Esaurito */}
                  <button
                    onClick={() => !esaurito && !senzaPrezzo && handleAdd(hit)}
                    disabled={esaurito || senzaPrezzo}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-opacity hover:opacity-80 disabled:opacity-40 flex-shrink-0"
                    style={{
                      background: (esaurito || senzaPrezzo) ? "#e5e7eb" : "#FFC803",
                      color: (esaurito || senzaPrezzo) ? "#9ca3af" : "#111",
                      fontFamily: "var(--font-montserrat)",
                      minWidth: 90,
                    }}>
                    <ShoppingCart size={12} />
                    {esaurito ? "Esaurito" : senzaPrezzo ? "Su richiesta" : "Aggiungi"}
                  </button>

                  {/* Foto */}
                  <div className="hidden xl:flex w-full items-center justify-center">
                    <button
                      onClick={() => setFotoModal(hit)}
                      className="w-8 h-8 flex items-center justify-center rounded-xl transition-colors hover:bg-gray-100"
                      style={{ border: "1px solid #e5e7eb" }}
                      title="Visualizza foto"
                    >
                      <ZoomIn size={14} style={{ color: "#6b7280" }} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Paginazione */}
          {nbPages > 1 && (
            <div className="flex items-center justify-center gap-2 py-2">
              <button onClick={() => { doSearch(page - 1); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                disabled={page === 0} className="p-2 rounded-xl disabled:opacity-30"
                style={{ background: "#fff", border: "1px solid #e5e7eb" }}>
                <ChevronLeft size={16} style={{ color: "#6b7280" }} />
              </button>
              {(() => {
                const windowSize = 7;
                const half = Math.floor(windowSize / 2);
                let start = Math.max(0, page - half);
                const end = Math.min(nbPages - 1, start + windowSize - 1);
                start = Math.max(0, end - windowSize + 1);
                return Array.from({ length: end - start + 1 }).map((_, i) => {
                  const idx = start + i;
                  const active = idx === page;
                  return (
                    <button key={idx} onClick={() => { doSearch(idx); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      className="w-9 h-9 rounded-xl text-sm font-semibold"
                      style={{ background: active ? "#FFC803" : "#fff", border: `1px solid ${active ? "#FFC803" : "#e5e7eb"}`, color: active ? "#111" : "#6b7280", fontFamily: "var(--font-montserrat)" }}>
                      {idx + 1}
                    </button>
                  );
                });
              })()}
              <button onClick={() => { doSearch(page + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                disabled={page >= nbPages - 1} className="p-2 rounded-xl disabled:opacity-30"
                style={{ background: "#fff", border: "1px solid #e5e7eb" }}>
                <ChevronRight size={16} style={{ color: "#6b7280" }} />
              </button>
            </div>
          )}
        </>
      )}
      {/* ── Modal foto prodotto ── */}
      {fotoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setFotoModal(null)} />
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full overflow-hidden"
            style={{ maxWidth: 720, fontFamily: "var(--font-montserrat)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #f3f4f6" }}>
              <h2 className="text-base font-bold truncate pr-4" style={{ color: "#111", fontFamily: "var(--font-poppins)" }}>
                {fotoModal.Marca} {formatMisura(fotoModal)}
                {fotoModal.Indice_Carico && fotoModal.Indice_Velocita
                  ? ` ${fotoModal.Indice_Carico}${fotoModal.Indice_Velocita}` : ""}
                {" "}{fotoModal.Modello}
              </h2>
              <button
                onClick={() => setFotoModal(null)}
                className="flex-shrink-0 p-1.5 rounded-xl hover:bg-gray-100 transition-colors"
                aria-label="Chiudi"
              >
                <X size={20} style={{ color: "#111" }} />
              </button>
            </div>

            {/* Contenuto */}
            <div className="flex items-start justify-center gap-6 px-6 py-6">
              {/* Foto prodotto */}
              {fotoModal.Foto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={fotoModal.Foto}
                  alt={`${fotoModal.Marca} ${fotoModal.Modello}`}
                  style={{ maxHeight: 340, maxWidth: 320, objectFit: "contain" }}
                />
              ) : fotoModal.Immagine ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={fotoModal.Immagine}
                  alt={fotoModal.Marca}
                  style={{ maxHeight: 200, maxWidth: 200, objectFit: "contain" }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2" style={{ width: 200, height: 200, background: "#f9fafb", borderRadius: 12 }}>
                  <ZoomIn size={40} style={{ color: "#d1d5db" }} />
                  <p className="text-xs" style={{ color: "#9ca3af" }}>Nessuna foto</p>
                </div>
              )}

              {/* Etichetta energetica */}
              {fotoModal.Label && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={fotoModal.Label}
                  alt="Etichetta energetica"
                  style={{ maxHeight: 340, maxWidth: 220, objectFit: "contain" }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
