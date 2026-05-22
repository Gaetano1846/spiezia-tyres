"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Search } from "lucide-react";
import { collection, getDocs, query, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import SearchableSelect from "@/components/ui/SearchableSelect";

const MARCHE = [
  "Michelin","Pirelli","Continental","Bridgestone","Goodyear",
  "Hankook","Yokohama","Dunlop","Falken","BFGoodrich","Toyo",
  "Kumho","Starmaxx","Kormoran","Nexen","Apollo","Compasal",
];

const INDICI_VELOCITA = ["P","Q","R","S","T","H","V","W","Y","Z"];
const INDICI_CARICO = Array.from({ length: 50 }, (_, i) => String(60 + i));

const STAGIONI = [
  { key: "Estive",     icon: "🔥", label: "Estive" },
  { key: "4-Stagioni", icon: "⚙️", label: "4 Stagioni" },
  { key: "Invernali",  icon: "❄️", label: "Invernali" },
] as const;

type PromoImg = { id: string; URL?: string; Immagine?: string; Ordine?: number };

export default function HomePage() {
  const router = useRouter();

  const [cerca, setCerca] = useState("");
  const [marchio, setMarchio] = useState("");
  const [indiceVelocita, setIndiceVelocita] = useState("");
  const [indiceCarico, setIndiceCarico] = useState("");
  const [stagioni, setStagioni] = useState<string[]>([]);
  const [promo, setPromo] = useState<PromoImg[]>([]);

  useEffect(() => {
    getDocs(query(collection(db, "Promo_Immagini"), limit(6)))
      .then((snap) =>
        setPromo(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PromoImg)))
      )
      .catch(() => {});
  }, []);

  function toggleStagione(s: string) {
    setStagioni((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  function handleCerca() {
    const params = new URLSearchParams();
    if (cerca) params.set("q", cerca);
    if (marchio) params.set("marca", marchio);
    if (indiceVelocita) params.set("iv", indiceVelocita);
    if (indiceCarico) params.set("ic", indiceCarico);
    if (stagioni.length > 0) params.set("stagione", stagioni.join(","));
    router.push(`/prodotti?${params.toString()}`);
  }

  return (
    <div>
      {/* ── Hero + Search Widget ── */}
      <div className="relative w-full" style={{ height: 520 }}>
        <Image
          src="/login-bg-b2b.jpg"
          alt="Spiezia Tyres"
          fill
          className="object-cover"
          priority
          unoptimized
        />
        <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.52)" }} />

        <div className="absolute inset-0 flex items-center justify-center px-4">
          <div
            className="w-full rounded-2xl p-6"
            style={{
              maxWidth: 520,
              background: "#fff",
              boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
            }}
          >
            <h2
              className="text-lg font-bold mb-4"
              style={{ fontFamily: "var(--font-poppins)", color: "#111" }}
            >
              Ricerca
            </h2>

            {/* Riga 1: Cerca + Marchio */}
            <div className="flex gap-3 mb-3">
              <input
                value={cerca}
                onChange={(e) => setCerca(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCerca()}
                placeholder="Cerca...."
                className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none"
                style={{
                  border: "1px solid #e5e7eb",
                  fontFamily: "var(--font-montserrat)",
                  color: "#111",
                }}
              />
              <SearchableSelect
                value={marchio}
                onChange={setMarchio}
                options={MARCHE}
                placeholder="Marchio"
                style={{ minWidth: 150 }}
              />
            </div>

            {/* Riga 2: Indice Velocità + Indice Carico + Stagioni */}
            <div className="flex gap-3 mb-5 items-center">
              <SearchableSelect
                value={indiceVelocita}
                onChange={setIndiceVelocita}
                options={INDICI_VELOCITA}
                placeholder="Indice di Velocità"
                style={{ flex: 1 }}
              />
              <SearchableSelect
                value={indiceCarico}
                onChange={setIndiceCarico}
                options={INDICI_CARICO}
                placeholder="Indice di Carico"
                style={{ flex: 1 }}
              />

              {/* Stagione toggle */}
              <div className="flex gap-1.5 flex-shrink-0">
                {STAGIONI.map((s) => {
                  const active = stagioni.includes(s.key);
                  return (
                    <button
                      key={s.key}
                      onClick={() => toggleStagione(s.key)}
                      title={s.label}
                      className="w-10 h-10 rounded-full text-lg flex items-center justify-center transition-all"
                      style={{
                        border: `2px solid ${active ? "#FFC803" : "#e5e7eb"}`,
                        background: active ? "#FFF8DC" : "#fff",
                        boxShadow: active ? "0 0 0 1px #FFC803" : "none",
                      }}
                    >
                      {s.icon}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottone Cerca */}
            <button
              onClick={handleCerca}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold transition-opacity hover:opacity-90"
              style={{
                background: "#FFC803",
                color: "#111",
                fontFamily: "var(--font-montserrat)",
              }}
            >
              <Search size={16} />
              Cerca
            </button>
          </div>
        </div>
      </div>

      {/* ── Contenuto sotto hero ── */}
      <div className="px-5 py-8 space-y-8">

        {/* Promo banners da Firestore */}
        {promo.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {promo.slice(0, 3).map((p) => {
              const src = p.URL ?? p.Immagine;
              if (!src) return null;
              return (
                <div
                  key={p.id}
                  className="rounded-2xl overflow-hidden"
                  style={{ border: "1px solid #e5e7eb", minHeight: 200 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt="Promozione"
                    className="w-full h-full object-cover"
                    style={{ minHeight: 200 }}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Brand distributor strip */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: "1px solid #e5e7eb" }}
        >
          <Image
            src="/distributore.png"
            alt="Spiezia Tyres — Distributore autorizzato"
            width={1200}
            height={250}
            className="w-full"
            style={{ maxHeight: 220, objectFit: "cover", objectPosition: "center" }}
            unoptimized
          />
        </div>
      </div>
    </div>
  );
}
