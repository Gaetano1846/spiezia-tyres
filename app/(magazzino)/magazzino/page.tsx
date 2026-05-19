import type { Metadata } from "next";
import { Package, MapPin, Plus } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import StatCard from "@/components/ui/StatCard";

export const metadata: Metadata = { title: "Magazzino" };

const stats = [
  { label: "Gabbie totali",    value: 48,  sub: "5 sedi",         icon: <Package size={22} />, accent: "#FFC803" },
  { label: "Pneumatici stoccati", value: 1240, sub: "aggiornato ora", icon: <Package size={22} />, accent: "#249689" },
  { label: "Gabbie vuote",     value: 6,   sub: "disponibili",    icon: <Package size={22} />, accent: "#EE8B60" },
];

const gabbie = [
  { posizione: "A-01", sede: "Nola",    tipo: "Invernali", qta: 24, cap: 30, stato: "quasi_piena" },
  { posizione: "A-02", sede: "Nola",    tipo: "Estive",    qta: 18, cap: 30, stato: "normale" },
  { posizione: "B-01", sede: "Volla",   tipo: "Miste",     qta: 0,  cap: 30, stato: "vuota" },
  { posizione: "B-02", sede: "Volla",   tipo: "Estive",    qta: 30, cap: 30, stato: "piena" },
  { posizione: "C-01", sede: "Portici", tipo: "Invernali", qta: 12, cap: 20, stato: "normale" },
  { posizione: "D-01", sede: "Roma",    tipo: "Miste",     qta: 8,  cap: 20, stato: "normale" },
];

const statoVariant: Record<string, "error" | "warning" | "neutral" | "success"> = {
  vuota: "neutral",
  normale: "success",
  quasi_piena: "warning",
  piena: "error",
};
const statoLabel: Record<string, string> = {
  vuota: "Vuota",
  normale: "Normale",
  quasi_piena: "Quasi piena",
  piena: "Piena",
};

export default function MagazzinoPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Magazzino</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            Gestione gabbie e stoccaggio pneumatici
          </p>
        </div>
        <button
          className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-poppins)" }}
        >
          <Plus size={16} /> Nuova gabbia
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      <Card>
        <h2 className="font-bold text-base mb-5" style={{ fontFamily: "var(--font-poppins)" }}>Gabbie per sede</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {gabbie.map((g) => {
            const pct = Math.round((g.qta / g.cap) * 100);
            return (
              <div
                key={g.posizione}
                className="rounded-xl p-4 cursor-pointer hover:shadow-md transition-shadow"
                style={{ border: "1px solid var(--border)" }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-bold text-sm" style={{ fontFamily: "var(--font-poppins)" }}>
                      Gabbia {g.posizione}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5" style={{ color: "var(--text-muted)" }}>
                      <MapPin size={11} />
                      <span className="text-xs" style={{ fontFamily: "var(--font-montserrat)" }}>{g.sede} · {g.tipo}</span>
                    </div>
                  </div>
                  <Badge variant={statoVariant[g.stato]}>{statoLabel[g.stato]}</Badge>
                </div>
                {/* Barra di occupazione */}
                <div className="mt-2">
                  <div className="flex justify-between text-xs mb-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                    <span>{g.qta}/{g.cap} pz</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-primary)" }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 90 ? "var(--error)" : pct >= 70 ? "var(--warning)" : "var(--success)",
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
