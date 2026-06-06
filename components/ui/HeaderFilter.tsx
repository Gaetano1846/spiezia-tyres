import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

// Filtro a tendina incastonato nell'intestazione tabella: chevron custom + padding
// adeguato così l'etichetta non viene mai tagliata dalla freccia nativa del browser.
// Sfondo/bordo gialli quando un filtro è attivo. Condiviso tra Ordini e Spedizioni.
export default function HeaderFilter({
  value, onChange, title, children,
}: {
  value: string;
  onChange: (v: string) => void;
  title: string;
  children: ReactNode;
}) {
  const active = !!value;
  return (
    <div className="relative w-full min-w-[7rem]">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={title}
        className="appearance-none w-full truncate pl-2.5 pr-7 py-1.5 rounded-lg text-[11px] font-semibold outline-none cursor-pointer transition-colors"
        style={{
          background: active ? "#FFF8DC" : "#fff",
          border: `1px solid ${active ? "#FFC803" : "var(--border)"}`,
          color: "#111",
          fontFamily: "var(--font-montserrat)",
        }}
      >
        {children}
      </select>
      <ChevronDown
        size={13}
        className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ color: active ? "#9a7b00" : "#9ca3af" }}
      />
    </div>
  );
}
