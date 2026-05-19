import type { Metadata } from "next";
import { Search, SlidersHorizontal, ShoppingCart, TrendingUp } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

export const metadata: Metadata = { title: "Catalogo Pneumatici" };

// Mock prodotti — in Fase 2 saranno da Algolia
const prodotti = [
  { id: "1", marca: "Michelin", modello: "Pilot Sport 5", misura: "225/45 R17", prezzo: 142.90, pfu: 3.41, stock: 8, stagione: "Estive", img: null },
  { id: "2", marca: "Pirelli",  modello: "Cinturato P7",  misura: "205/55 R16", prezzo: 118.50, pfu: 3.05, stock: 12, stagione: "Estive", img: null },
  { id: "3", marca: "Continental", modello: "WinterContact TS 870", misura: "215/60 R16", prezzo: 134.20, pfu: 3.05, stock: 4, stagione: "Invernali", img: null },
  { id: "4", marca: "Bridgestone", modello: "Turanza T005",   misura: "225/45 R18", prezzo: 156.80, pfu: 3.80, stock: 6, stagione: "Estive", img: null },
  { id: "5", marca: "Goodyear",    modello: "EfficientGrip 2",misura: "195/65 R15", prezzo: 98.40,  pfu: 2.68, stock: 20, stagione: "Estive", img: null },
  { id: "6", marca: "Hankook",     modello: "Ventus S1 evo3", misura: "245/40 R18", prezzo: 167.30, pfu: 3.80, stock: 3, stagione: "Estive", img: null },
];

const stagioneBadge: Record<string, "brand" | "neutral" | "neutral"> = {
  Estive: "brand",
  Invernali: "neutral",
  "4-Stagioni": "success" as never,
};

function formatEuro(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

export default function CatalogPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
            Catalogo Pneumatici
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            {prodotti.length} prodotti disponibili
          </p>
        </div>
        <button
          className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold transition-colors"
          style={{ background: "var(--bg-primary)", color: "var(--text-primary)", fontFamily: "var(--font-montserrat)", border: "1px solid var(--border)" }}
        >
          <ShoppingCart size={16} />
          Carrello <span className="bg-[#FFC803] text-[#111] text-xs font-bold px-1.5 py-0.5 rounded-full">0</span>
        </button>
      </div>

      {/* Search + filtri */}
      <Card padding="sm">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              placeholder="Cerca per misura (es. 205/55 R16) o marca…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none transition-colors"
              style={{
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                fontFamily: "var(--font-montserrat)",
                color: "var(--text-primary)",
              }}
            />
          </div>
          <button
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}
          >
            <SlidersHorizontal size={16} />
            Filtri
          </button>
        </div>
      </Card>

      {/* Griglia prodotti */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {prodotti.map((p) => (
          <div
            key={p.id}
            className="rounded-2xl overflow-hidden cursor-pointer group transition-shadow hover:shadow-lg"
            style={{ background: "#fff", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}
          >
            {/* Immagine placeholder */}
            <div
              className="h-44 flex items-center justify-center text-5xl"
              style={{ background: "var(--bg-primary)" }}
            >
              🔘
            </div>

            <div className="p-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                    {p.marca}
                  </p>
                  <p className="text-sm font-semibold leading-tight" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                    {p.modello}
                  </p>
                </div>
                <Badge variant={stagioneBadge[p.stagione] ?? "neutral"}>{p.stagione}</Badge>
              </div>

              <p className="text-xs mb-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                {p.misura}
              </p>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
                    {formatEuro(p.prezzo)}
                  </p>
                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    + PFU {formatEuro(p.pfu)} · {p.stock} pz
                  </p>
                </div>
                <button
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold transition-colors"
                  style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-poppins)" }}
                >
                  <ShoppingCart size={13} /> Aggiungi
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Promo banner */}
      <div
        className="rounded-2xl p-6 flex items-center gap-5"
        style={{ background: "linear-gradient(135deg, #111 0%, #292929 100%)", color: "#fff" }}
      >
        <TrendingUp size={40} style={{ color: "var(--brand)", flexShrink: 0 }} />
        <div>
          <p className="font-bold text-base" style={{ fontFamily: "var(--font-poppins)" }}>
            Promozioni attive
          </p>
          <p className="text-sm mt-0.5 text-white/60" style={{ fontFamily: "var(--font-montserrat)" }}>
            Le tue promozioni personalizzate vengono applicate automaticamente al carrello.
          </p>
        </div>
      </div>
    </div>
  );
}
