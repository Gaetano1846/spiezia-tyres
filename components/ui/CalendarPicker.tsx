"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const GIORNI = ["Lu", "Ma", "Me", "Gi", "Ve", "Sa", "Do"];
const MESI = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Props {
  /** Data selezionata in formato ISO yyyy-mm-dd ("" = nessuna) */
  value: string;
  onChange: (iso: string) => void;
}

/**
 * Calendario a data singola, stile identico a CalendarRangePicker (brand giallo).
 * Mon-first, navigazione mese, evidenzia oggi e la data selezionata.
 */
export default function CalendarPicker({ value, onChange }: Props) {
  const today = toISO(new Date());
  const initDate = value ? new Date(value + "T00:00:00") : new Date();
  const [viewYear, setViewYear]   = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());

  function prevMonth() {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  }

  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const daysInMonth  = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function getCellStyle(day: number): React.CSSProperties {
    const iso = toISO(new Date(viewYear, viewMonth, day));
    if (iso === value) {
      return { background: "#FFC803", color: "#111", borderRadius: "8px", fontWeight: 700 };
    }
    if (iso === today) {
      return { outline: "2px solid #FFC803", outlineOffset: "-2px", borderRadius: "8px", color: "#FFC803", fontWeight: 700 };
    }
    return { color: "#374151" };
  }

  return (
    <div style={{ fontFamily: "var(--font-montserrat)", minWidth: 280 }}>
      {/* Month nav */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid #e5e7eb" }}>
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <ChevronLeft size={18} style={{ color: "#374151" }} />
        </button>
        <span className="text-sm font-bold" style={{ color: "#111", fontFamily: "var(--font-poppins)" }}>
          {MESI[viewMonth]} {viewYear}
        </span>
        <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <ChevronRight size={18} style={{ color: "#374151" }} />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 px-3 mb-1 mt-2">
        {GIORNI.map((g) => (
          <div key={g} className="text-center text-[11px] font-bold py-1" style={{ color: "#9ca3af" }}>
            {g}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 px-3 pb-4 gap-y-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          return (
            <button
              key={i}
              onClick={() => onChange(toISO(new Date(viewYear, viewMonth, day)))}
              className="h-9 flex items-center justify-center text-sm transition-all hover:opacity-75 w-full"
              style={getCellStyle(day)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
