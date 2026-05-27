"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, X, Check } from "lucide-react";

type Props = {
  values: string[];
  onChange: (v: string[]) => void;
  options: string[];
  placeholder?: string;
  style?: React.CSSProperties;
};

type Rect = { top: number; left: number; width: number; maxListHeight: number };

export default function MultiSearchableSelect({
  values,
  onChange,
  options,
  placeholder = "Seleziona",
  style,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [rect, setRect] = useState<Rect | null>(null);
  const [mounted, setMounted] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setMounted(true); }, []);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(search.toLowerCase())
  );

  const calcRect = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const SEARCH_BAR_H = 45;
    const PADDING = 12;
    const spaceBelow = vh - r.bottom - 4 - PADDING;
    const spaceAbove = r.top - 4 - PADDING;
    const maxListHeight = Math.max(Math.min(spaceBelow - SEARCH_BAR_H, 260), 80);
    const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
    const top = openAbove
      ? r.top - 4 - Math.min(spaceAbove, maxListHeight + SEARCH_BAR_H)
      : r.bottom + 4;

    setRect({
      top,
      left: r.left,
      width: Math.max(r.width, 200),
      maxListHeight: openAbove
        ? Math.min(spaceAbove - SEARCH_BAR_H - PADDING, 260)
        : maxListHeight,
    });
  }, []);

  useEffect(() => {
    if (open) {
      setSearch("");
      calcRect();
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, calcRect]);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !dropdownRef.current?.contains(t))
        setOpen(false);
    }
    function onScroll() { setOpen(false); }
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function toggle(o: string) {
    onChange(values.includes(o) ? values.filter((v) => v !== o) : [...values, o]);
  }

  function clearAll(e: React.MouseEvent) {
    e.stopPropagation();
    onChange([]);
  }

  const dropdown =
    mounted && open && rect
      ? createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              width: rect.width,
              zIndex: 9999,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
            }}
          >
            {/* search bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid #f3f4f6" }}>
              <Search size={13} style={{ color: "#9ca3af", flexShrink: 0 }} />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca marca..."
                style={{ flex: 1, fontSize: 13, outline: "none", border: "none", background: "transparent", color: "#111", fontFamily: "var(--font-montserrat)" }}
              />
              {values.length > 0 && (
                <button type="button" onClick={() => onChange([])} style={{ fontSize: 11, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>
                  Deseleziona tutto
                </button>
              )}
            </div>

            {/* options */}
            <ul style={{ listStyle: "none", margin: 0, padding: "4px 0", maxHeight: rect.maxListHeight, overflowY: "auto" }}>
              {filtered.length === 0 ? (
                <li style={{ padding: "8px 12px", fontSize: 12, color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                  Nessun risultato
                </li>
              ) : (
                filtered.map((o) => {
                  const selected = values.includes(o);
                  return (
                    <li key={o}>
                      <button
                        type="button"
                        onClick={() => toggle(o)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          width: "100%",
                          textAlign: "left",
                          padding: "8px 12px",
                          fontSize: 14,
                          fontFamily: "var(--font-montserrat)",
                          color: "#374151",
                          background: selected ? "#FFF8DC" : "transparent",
                          border: "none",
                          cursor: "pointer",
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "#f9fafb"; }}
                        onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
                      >
                        <span style={{
                          width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                          border: selected ? "none" : "1.5px solid #d1d5db",
                          background: selected ? "#FFC803" : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          {selected && <Check size={11} style={{ color: "#111" }} />}
                        </span>
                        {o}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="relative" style={style}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "10px 12px",
          borderRadius: 12,
          border: `1px solid ${open ? "#FFC803" : "#e5e7eb"}`,
          background: "#fff",
          fontFamily: "var(--font-montserrat)",
          fontSize: 14,
          color: values.length > 0 ? "#111" : "#9ca3af",
          cursor: "pointer",
          gap: 6,
          minHeight: 44,
        }}
      >
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden" }}>
          {values.length === 0 ? (
            placeholder
          ) : values.length === 1 ? (
            values[0]
          ) : (
            <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {values.map((v) => (
                <span
                  key={v}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 3,
                    background: "#FFF8DC", border: "1px solid #FFC803",
                    borderRadius: 99, padding: "1px 7px",
                    fontSize: 12, color: "#92700A", fontWeight: 600,
                  }}
                >
                  {v}
                </span>
              ))}
            </span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {values.length > 0 && (
            <span
              onClick={clearAll}
              style={{ cursor: "pointer", color: "#9ca3af", display: "flex" }}
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown
            size={14}
            style={{ color: "#9ca3af", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
          />
        </span>
      </button>

      {dropdown}
    </div>
  );
}
