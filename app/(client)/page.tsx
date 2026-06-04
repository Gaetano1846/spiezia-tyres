"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Search } from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import SearchableSelect from "@/components/ui/SearchableSelect";
import MultiSearchableSelect from "@/components/ui/MultiSearchableSelect";

const MARCHE = [
  "Michelin","Pirelli","Continental","Bridgestone","Goodyear",
  "Hankook","Yokohama","Dunlop","Falken","BFGoodrich","Toyo",
  "Kumho","Starmaxx","Kormoran","Nexen","Apollo","Compasal",
];

const INDICI_VELOCITA = ["P","Q","R","S","T","H","V","W","Y","Z"];
const INDICI_CARICO   = Array.from({ length: 50 }, (_, i) => String(60 + i));

const STAGIONI = [
  { key: "Estive",     icon: "🔥", label: "Estive" },
  { key: "4-Stagioni", icon: "⚙️", label: "4 Stagioni" },
  { key: "Invernali",  icon: "❄️", label: "Invernali" },
] as const;

type PromoImg = { id: string; Url?: string; URL?: string; Immagine?: string; Ordine?: number; Attivo?: boolean };

export default function HomePage() {
  const router = useRouter();

  const [cerca,          setCerca]          = useState("");
  const [marche,         setMarche]         = useState<string[]>([]);
  const [indiceVelocita, setIndiceVelocita] = useState("");
  const [indiceCarico,   setIndiceCarico]   = useState("");
  const [stagioni,       setStagioni]       = useState<string[]>([]);
  const [promo,          setPromo]          = useState<PromoImg[]>([]);

  useEffect(() => {
    getDocs(collection(db, "Promo_Immagini"))
      .then((snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as PromoImg))
          .filter((p) => p.Attivo !== false)          // mostra tutti salvo Attivo==false esplicito
          .sort((a, b) => (a.Ordine ?? 0) - (b.Ordine ?? 0));
        setPromo(items);
      })
      .catch(() => {});
  }, []);

  function toggleStagione(s: string) {
    setStagioni((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  function handleCerca() {
    const params = new URLSearchParams();
    if (cerca)           params.set("q",       cerca);
    if (marche.length)   params.set("marca",   marche.join(","));
    if (indiceVelocita)  params.set("iv",      indiceVelocita);
    if (indiceCarico)    params.set("ic",      indiceCarico);
    if (stagioni.length) params.set("stagione",stagioni.join(","));
    router.push(`/prodotti?${params.toString()}`);
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Background: widget ricerca + card promo ── */}
      <div className="relative w-full flex-1 min-h-0 overflow-hidden">
        <Image
          src="/login-bg-b2b.jpg"
          alt="Spiezia Tyres"
          fill
          className="object-cover"
          priority
          unoptimized
        />
        <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.50)" }} />

        <div className="relative z-10 h-full min-h-0 flex flex-col justify-center px-4 sm:px-5 py-3 sm:py-5 gap-3 sm:gap-4">

          {/* Widget di ricerca */}
          <div
            className="w-full mx-auto rounded-2xl p-4 sm:p-5 flex-shrink-0"
            style={{ maxWidth: 560, background: "#fff", boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }}
          >
            <div className="flex items-center gap-2.5 mb-3 sm:mb-4">
              <span className="w-1 h-7 rounded-full flex-shrink-0" style={{ background: "var(--brand)" }} />
              <div>
                <h2 className="text-lg font-bold leading-none" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
                  Ricerca pneumatici
                </h2>
                <p className="text-xs mt-1 leading-none" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
                  Trova la gomma giusta in pochi secondi
                </p>
              </div>
            </div>

            {/* Cerca + Marchio */}
            <div className="flex gap-2 mb-3">
              <input
                value={cerca}
                onChange={(e) => setCerca(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCerca()}
                placeholder="Cerca misura, modello..."
                className="flex-1 min-w-0 px-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#111" }}
              />
              <div className="w-32 sm:w-40 flex-shrink-0">
                <MultiSearchableSelect
                  values={marche}
                  onChange={setMarche}
                  options={MARCHE}
                  placeholder="Marchio"
                />
              </div>
            </div>

            {/* Indice Velocità + Indice Carico + Stagioni */}
            <div className="flex gap-2 mb-3 sm:mb-5 items-center flex-wrap">
              <SearchableSelect
                value={indiceVelocita}
                onChange={setIndiceVelocita}
                options={INDICI_VELOCITA}
                placeholder="Indice di Velocità"
                style={{ flex: 1, minWidth: 120 }}
              />
              <SearchableSelect
                value={indiceCarico}
                onChange={setIndiceCarico}
                options={INDICI_CARICO}
                placeholder="Indice di Carico"
                style={{ flex: 1, minWidth: 120 }}
              />
              <div className="flex gap-1.5 flex-shrink-0">
                {STAGIONI.map((s) => {
                  const active = stagioni.includes(s.key);
                  return (
                    <button
                      key={s.key}
                      onClick={() => toggleStagione(s.key)}
                      title={s.label}
                      className="w-10 h-10 rounded-full text-lg flex items-center justify-center transition-all hover:brightness-95 active:scale-95"
                      style={{
                        border: `2px solid ${active ? "#FFC803" : "#e5e7eb"}`,
                        background: active ? "#FFF8DC" : "#fff",
                        boxShadow: active ? "0 2px 8px rgba(255,200,3,.40)" : "none",
                      }}
                    >
                      {s.icon}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={handleCerca}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold transition-all hover:brightness-[1.04] active:scale-[.985]"
              style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}
            >
              <Search size={16} /> Cerca
            </button>
          </div>

          {/* Card promo — scorrevoli orizzontalmente.
              NB: `justify-start` (non `justify-center`) è obbligatorio in un container
              overflow-x: con justify-center il primo banner viene centrato e il suo
              bordo sinistro finisce fuori schermo, irraggiungibile dallo scroll (che va
              solo verso destra). Con justify-start la striscia parte a filo sinistra. */}
          {promo.length > 0 && (
            <div
              className="flex-1 min-h-0 max-h-[15vh] sm:max-h-none flex justify-start overflow-x-auto overflow-y-hidden pb-2 snap-x snap-mandatory sm:snap-none"
              style={{ gap: 25, scrollbarWidth: "thin", scrollbarColor: "#FFC803 rgba(255,255,255,0.2)" }}
            >
              {promo.map((p) => {
                const src = p.Url ?? p.URL ?? p.Immagine;
                if (!src) return null;
                return (
                  <div
                    key={p.id}
                    className="flex-shrink-0 h-full overflow-hidden shadow-2xl snap-start"
                    style={{ borderRadius: 12 }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt="Promozione"
                      style={{ height: "100%", width: "auto", display: "block", objectFit: "cover" }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Striscia distributori ── */}
      <div className="py-3 flex justify-center flex-shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/distributore.png"
          alt="Spiezia Tyres — Distributore autorizzato"
          className="w-[85vw] sm:w-[55vw] max-h-[16vh] sm:max-h-[11vh] object-contain"
        />
      </div>
    </div>
  );
}
