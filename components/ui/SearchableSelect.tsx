"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, X } from "lucide-react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  style?: React.CSSProperties;
};

type Rect = { top: number; left: number; width: number; maxListHeight: number };

export default function SearchableSelect({
  value,
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
    const SEARCH_BAR_H = 45; // search input height
    const PADDING = 12;       // bottom margin from viewport edge

    const spaceBelow = vh - r.bottom - 4 - PADDING;
    const spaceAbove = r.top - 4 - PADDING;
    const maxListHeight = Math.max(
      Math.min(spaceBelow - SEARCH_BAR_H, 240),
      80
    );

    // Flip upward if there's not enough room below
    const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
    const top = openAbove
      ? r.top - 4 - Math.min(spaceAbove, maxListHeight + SEARCH_BAR_H)
      : r.bottom + 4;

    setRect({
      top,
      left: r.left,
      width: Math.max(r.width, 180),
      maxListHeight: openAbove
        ? Math.min(spaceAbove - SEARCH_BAR_H - PADDING, 240)
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

  // close on outside click or scroll
  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      const t = e.target as Node;
      if (
        !triggerRef.current?.contains(t) &&
        !dropdownRef.current?.contains(t)
      ) setOpen(false);
    }
    function onScroll(e: Event) {
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderBottom: "1px solid #f3f4f6",
              }}
            >
              <Search size={13} style={{ color: "#9ca3af", flexShrink: 0 }} />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca..."
                style={{
                  flex: 1,
                  fontSize: 13,
                  outline: "none",
                  border: "none",
                  background: "transparent",
                  color: "#111",
                  fontFamily: "var(--font-montserrat)",
                }}
              />
            </div>

            {/* options */}
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: "4px 0",
                maxHeight: rect.maxListHeight,
                overflowY: "auto",
              }}
            >
              {filtered.length === 0 ? (
                <li
                  style={{
                    padding: "8px 12px",
                    fontSize: 12,
                    color: "#9ca3af",
                    fontFamily: "var(--font-montserrat)",
                  }}
                >
                  Nessun risultato
                </li>
              ) : (
                filtered.map((o) => {
                  const isActive = o === value;
                  return (
                    <li key={o}>
                      <button
                        type="button"
                        onClick={() => { onChange(o); setOpen(false); }}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "8px 12px",
                          fontSize: 14,
                          fontFamily: "var(--font-montserrat)",
                          color: isActive ? "#111" : "#374151",
                          fontWeight: isActive ? 700 : 400,
                          background: isActive ? "#FFF8DC" : "transparent",
                          border: "none",
                          cursor: "pointer",
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive)
                            e.currentTarget.style.background = "#FFF8DC";
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive)
                            e.currentTarget.style.background = "transparent";
                        }}
                      >
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
          border: "1px solid #e5e7eb",
          background: "#fff",
          fontFamily: "var(--font-montserrat)",
          fontSize: 14,
          color: value ? "#111" : "#9ca3af",
          cursor: "pointer",
          gap: 4,
        }}
      >
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textAlign: "left",
          }}
        >
          {value || placeholder}
        </span>
        {value ? (
          <X
            size={14}
            style={{ color: "#9ca3af", flexShrink: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
              setOpen(false);
            }}
          />
        ) : (
          <ChevronDown size={14} style={{ color: "#9ca3af", flexShrink: 0 }} />
        )}
      </button>

      {dropdown}
    </div>
  );
}
