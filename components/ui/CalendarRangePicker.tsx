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

function isoToDisplay(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

interface Props {
  dataDa: string;
  dataA: string;
  onChange: (da: string, a: string) => void;
}

export default function CalendarRangePicker({ dataDa, dataA, onChange }: Props) {
  const today = toISO(new Date());

  // View state — which month is shown
  const initDate = dataDa ? new Date(dataDa + "T00:00:00") : new Date();
  const [viewYear, setViewYear]   = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());

  // Internal selection state (committed to parent on each click)
  const [tempStart, setTempStart] = useState(dataDa);
  const [tempEnd, setTempEnd]     = useState(dataA);
  // picking: "end" means start is set and waiting for end
  const [pickingEnd, setPickingEnd] = useState(false);

  function prevMonth() {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  }

  // Build grid cells (Mon-first)
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const daysInMonth  = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function handleDayClick(day: number) {
    const iso = toISO(new Date(viewYear, viewMonth, day));

    if (!pickingEnd) {
      // Start fresh — set start, clear end
      setTempStart(iso);
      setTempEnd("");
      setPickingEnd(true);
      onChange(iso, iso);
    } else {
      if (iso >= tempStart) {
        setTempEnd(iso);
        setPickingEnd(false);
        onChange(tempStart, iso);
      } else {
        // Clicked before start → restart from this date
        setTempStart(iso);
        setTempEnd("");
        onChange(iso, iso);
      }
    }
  }

  function getCellStyle(day: number): React.CSSProperties {
    const iso = toISO(new Date(viewYear, viewMonth, day));
    const isStart   = iso === tempStart;
    const isEnd     = iso === tempEnd && tempEnd !== tempStart;
    const inRange   = tempStart && tempEnd && iso > tempStart && iso < tempEnd;
    const isToday   = iso === today;
    const isSelected = isStart || isEnd;

    if (isSelected) {
      return { background: "#FFC803", color: "#111", borderRadius: "8px", fontWeight: 700 };
    }
    if (inRange) {
      return { background: "#FFF3B0", color: "#111", borderRadius: "4px", fontWeight: 600 };
    }
    if (isToday) {
      return { outline: "2px solid #FFC803", outlineOffset: "-2px", borderRadius: "8px", color: "#FFC803", fontWeight: 700 };
    }
    return { color: "#374151" };
  }

  const rangeLabel = tempEnd && tempEnd !== tempStart
    ? `${isoToDisplay(tempStart)} - ${isoToDisplay(tempEnd)}`
    : tempStart
    ? isoToDisplay(tempStart)
    : "—";

  return (
    <div style={{ fontFamily: "var(--font-montserrat)", minWidth: 280 }}>
      {/* Range label */}
      <div
        className="text-center py-3 text-sm font-bold"
        style={{ borderBottom: "1px solid #e5e7eb", color: "#111", fontFamily: "var(--font-poppins)" }}
      >
        {rangeLabel}
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={prevMonth}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ChevronLeft size={18} style={{ color: "#374151" }} />
        </button>
        <span className="text-sm font-bold" style={{ color: "#111" }}>
          {MESI[viewMonth]} {viewYear}
        </span>
        <button
          onClick={nextMonth}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ChevronRight size={18} style={{ color: "#374151" }} />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 px-3 mb-1">
        {GIORNI.map((g) => (
          <div
            key={g}
            className="text-center text-[11px] font-bold py-1"
            style={{ color: "#9ca3af" }}
          >
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
              onClick={() => handleDayClick(day)}
              className="h-9 flex items-center justify-center text-sm transition-all hover:opacity-75 w-full"
              style={getCellStyle(day)}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* Hint */}
      {pickingEnd && (
        <div className="text-center pb-3 text-xs" style={{ color: "#9ca3af" }}>
          Seleziona la data di fine
        </div>
      )}
    </div>
  );
}
