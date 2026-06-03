"use client";

import { useState, useRef } from "react";
import { Calendar as CalendarIcon, X } from "lucide-react";
import CalendarPicker from "./CalendarPicker";
import AnchoredPopover from "./AnchoredPopover";

function isoToDisplay(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

interface Props {
  /** Data ISO yyyy-mm-dd ("" = nessuna) */
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  /** Padding/classi del bottone trigger (default px-3 py-2 per i filtri) */
  className?: string;
  /** Occupa tutta la larghezza (per i campi nei form) */
  fullWidth?: boolean;
  allowClear?: boolean;
}

/**
 * Selettore di data brandizzato: bottone con la data formattata + icona calendario,
 * apre il CalendarPicker in un popover (dropdown su desktop, modale centrato su mobile).
 * Sostituisce <input type="date"> per uniformità visiva (stile CalendarRangePicker).
 */
export default function DateField({ value, onChange, placeholder = "Data", className = "px-3 py-2", fullWidth = false, allowClear = true }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={`relative ${fullWidth ? "w-full" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-xl text-sm outline-none ${fullWidth ? "w-full justify-between" : ""} ${className}`}
        style={{
          background: value ? "#FFC80320" : "var(--bg-primary)",
          border: value ? "1px solid #FFC803" : "1px solid var(--border)",
          fontFamily: "var(--font-montserrat)",
          color: value ? "var(--text-primary)" : "var(--text-muted)",
        }}
      >
        <CalendarIcon size={14} style={{ color: value ? "#B45309" : "var(--text-muted)" }} />
        <span>{value ? isoToDisplay(value) : placeholder}</span>
        {allowClear && value && (
          <X
            size={14}
            style={{ color: "var(--text-muted)" }}
            onClick={(e) => { e.stopPropagation(); onChange(""); }}
          />
        )}
      </button>

      <AnchoredPopover open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} width={320}>
        <CalendarPicker
          value={value}
          onChange={(iso) => { onChange(iso); setOpen(false); }}
        />
        <div className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: "1px solid #e5e7eb" }}>
          {allowClear ? (
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); }}
              className="text-xs font-semibold"
              style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}
            >
              Azzera
            </button>
          ) : <span />}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs font-bold px-3 py-1.5 rounded-lg"
            style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
          >
            Chiudi
          </button>
        </div>
      </AnchoredPopover>
    </div>
  );
}
