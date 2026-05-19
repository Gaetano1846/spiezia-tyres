import type { Metadata } from "next";
import { ShoppingBag, Search, Filter } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import StatCard from "@/components/ui/StatCard";

export const metadata: Metadata = { title: "Ordini" };

const stats = [
  { label: "Totale ordini",     value: 1284, sub: "ultimi 30gg",     icon: <ShoppingBag size={22} />, accent: "#FFC803" },
  { label: "In lavorazione",    value: 47,   sub: "da evadere",      icon: <ShoppingBag size={22} />, accent: "#EE8B60" },
  { label: "Spediti oggi",      value: 23,   sub: "su 28 confermati",icon: <ShoppingBag size={22} />, accent: "#249689" },
  { label: "Annullati",         value: 8,    sub: "questo mese",     icon: <ShoppingBag size={22} />, accent: "#FF5963" },
];

const ordini = [
  { id: "ORD-2401", cliente: "Autofficina Rossi",    importo: 523.40,  stato: "Confermato",     fonte: "B2B",     data: "19/05/2026" },
  { id: "ORD-2400", cliente: "Gommista Centrale",    importo: 1284.00, stato: "In lavorazione", fonte: "B2B",     data: "19/05/2026" },
  { id: "ORD-2399", cliente: "Amazon Customer",      importo: 298.70,  stato: "Spedito",        fonte: "Amazon",  data: "18/05/2026" },
  { id: "ORD-2398", cliente: "eBay Buyer 1294",      importo: 167.30,  stato: "Spedito",        fonte: "eBay",    data: "18/05/2026" },
  { id: "ORD-2397", cliente: "Mario Bianchi",        importo: 451.20,  stato: "Consegnato",     fonte: "B2B",     data: "17/05/2026" },
  { id: "ORD-2396", cliente: "Pneumatici Sud SRL",   importo: 2340.00, stato: "Confermato",     fonte: "B2B",     data: "17/05/2026" },
  { id: "ORD-2395", cliente: "WooCommerce Order",    importo: 89.90,   stato: "Annullato",      fonte: "WooCommerce", data: "16/05/2026" },
];

const statoVariant: Record<string, "success" | "brand" | "warning" | "error" | "neutral"> = {
  Confermato:     "brand",
  "In lavorazione": "warning",
  Spedito:        "success",
  Consegnato:     "neutral",
  Annullato:      "error",
};

const fonteColors: Record<string, string> = {
  B2B: "#FFC803",
  Amazon: "#F9A825",
  eBay: "#E53935",
  WooCommerce: "#9C27B0",
};

function formatEuro(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

export default function OrdiniPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Ordini</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
          Tutti i canali: B2B, eBay, Amazon, WooCommerce
        </p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      <Card padding="sm">
        <div className="flex gap-3 mb-4">
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              placeholder="Cerca per ID, cliente, importo…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }}
            />
          </div>
          <button
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)" }}
          >
            <Filter size={15} /> Filtri
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
            <thead>
              <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                {["ID Ordine", "Cliente", "Data", "Fonte", "Importo", "Stato", ""].map((h) => (
                  <th key={h} className="pb-3 pr-4 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
              {ordini.map((o) => (
                <tr key={o.id} className="hover:bg-[#F9FAFB] transition-colors cursor-pointer">
                  <td className="py-3.5 pr-4 font-semibold" style={{ color: "var(--text-primary)" }}>{o.id}</td>
                  <td className="py-3.5 pr-4" style={{ color: "var(--text-primary)" }}>{o.cliente}</td>
                  <td className="py-3.5 pr-4" style={{ color: "var(--text-secondary)" }}>{o.data}</td>
                  <td className="py-3.5 pr-4">
                    <span
                      className="px-2.5 py-1 rounded-full text-xs font-bold text-white"
                      style={{ background: fonteColors[o.fonte] ?? "#666" }}
                    >
                      {o.fonte}
                    </span>
                  </td>
                  <td className="py-3.5 pr-4 font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatEuro(o.importo)}
                  </td>
                  <td className="py-3.5 pr-4">
                    <Badge variant={statoVariant[o.stato] ?? "neutral"}>{o.stato}</Badge>
                  </td>
                  <td className="py-3.5">
                    <button className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
                      Dettagli
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
