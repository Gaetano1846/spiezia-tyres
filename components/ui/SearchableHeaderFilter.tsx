"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check, X } from "lucide-react";
import AnchoredPopover from "./AnchoredPopover";

// Variante cercabile di HeaderFilter: stesso look incastonato nell'intestazione
// tabella (sfondo/bordo gialli quando attivo), ma al click apre un popover con
// campo di ricerca + lista filtrabile. Pensato per dropdown con molte opzioni
// (es. Marca, 170+ voci) dove il <select> nativo è inutilizzabile.
interface Props {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  /** Etichetta del trigger quando nessun valore è selezionato + voce "azzera". */
  placeholder: string;
  /** Tooltip del trigger. */
  title?: string;
  /** Placeholder dell'input di ricerca. */
  searchPlaceholder?: string;
  /** Larghezza del popover (px). Default 260. */
  width?: number;
}

export default function SearchableHeaderFilter({
  value, onChange, options, placeholder, title,
  searchPlaceholder = "Cerca…", width = 260,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const active = !!value;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  // indice 0 = voce "tutte" (azzera); 1..N = opzioni filtrate
  const total = filtered.length + 1;

  // All'apertura: reset query e focus sull'input (dopo il posizionamento del popover)
  useEffect(() => {
    if (!open) { setQuery(""); setHighlight(0); return; }
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Tieni l'elemento evidenziato visibile nello scroll della lista
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  function select(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(total - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight === 0) select("");
      else { const o = filtered[highlight - 1]; if (o !== undefined) select(o); }
    }
  }

  return (
    <div className="relative w-full min-w-[7rem]">
      <button
        ref={triggerRef}
        type="button"
        title={title}
        onClick={() => setOpen((v) => !v)}
        className="w-full truncate text-left pl-2.5 pr-7 py-1.5 rounded-lg text-[11px] font-semibold outline-none cursor-pointer transition-colors"
        style={{
          background: active ? "#FFF8DC" : "#fff",
          border: `1px solid ${active ? "#FFC803" : "var(--border)"}`,
          color: "#111",
          fontFamily: "var(--font-montserrat)",
        }}
      >
        {value || placeholder}
      </button>
      <ChevronDown
        size={13}
        className="absolute right-2 top-1/2 pointer-events-none transition-transform"
        style={{
          color: active ? "#9a7b00" : "#9ca3af",
          transform: open ? "translateY(-50%) rotate(180deg)" : "translateY(-50%)",
        }}
      />

      <AnchoredPopover open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} width={width} align="left">
        <div className="flex flex-col" style={{ maxHeight: 360 }}>
          {/* Campo ricerca */}
          <div className="p-2" style={{ background: "#fff", borderBottom: "1px solid #f3f4f6" }}>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "#9ca3af" }} />
              <input
                ref={inputRef}
                value={query}
                autoFocus
                onChange={(e) => { setQuery(e.target.value); setHighlight(e.target.value.trim() ? 1 : 0); }}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder}
                className="w-full pl-8 pr-7 py-2 rounded-xl text-sm outline-none"
                style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#111" }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(""); setHighlight(0); inputRef.current?.focus(); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-200"
                >
                  <X size={12} style={{ color: "#9ca3af" }} />
                </button>
              )}
            </div>
          </div>

          {/* Lista */}
          <div ref={listRef} className="overflow-y-auto py-1" style={{ maxHeight: 300 }}>
            {/* Voce "tutte" / azzera */}
            <button
              type="button"
              data-idx={0}
              onMouseEnter={() => setHighlight(0)}
              onClick={() => select("")}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors"
              style={{
                background: highlight === 0 ? "#FFF8DC" : "transparent",
                color: "#6b7280",
                fontFamily: "var(--font-montserrat)",
                fontWeight: value === "" ? 700 : 500,
              }}
            >
              <span className="truncate">{placeholder}</span>
              {value === "" && <Check size={14} style={{ color: "#9a7b00" }} className="flex-shrink-0" />}
            </button>

            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                Nessun risultato
              </div>
            ) : (
              filtered.map((o, i) => {
                const idx = i + 1;
                const selected = o === value;
                return (
                  <button
                    key={o}
                    type="button"
                    data-idx={idx}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => select(o)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors"
                    style={{
                      background: idx === highlight ? "#FFF8DC" : "transparent",
                      color: "#111",
                      fontFamily: "var(--font-montserrat)",
                      fontWeight: selected ? 700 : 500,
                    }}
                  >
                    <span className="truncate">{o}</span>
                    {selected && <Check size={14} style={{ color: "#9a7b00" }} className="flex-shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </AnchoredPopover>
    </div>
  );
}
