"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Elemento di ancoraggio (il bottone/trigger) rispetto a cui posizionare il popover su desktop. */
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  /** Larghezza desktop del popover (px). Default 320. */
  width?: number;
  /** Allineamento desktop preferito rispetto all'ancora (poi viene comunque clampato ai bordi). */
  align?: "left" | "right";
  /** Soglia (px) oltre la quale si usa il popover ancorato invece del modale centrato. Default 640 (sm).
   *  Va allineata al breakpoint a cui il trigger passa da inline a desktop (es. 1280 = xl). */
  desktopMinWidth?: number;
}

const GAP = 6;     // spazio tra ancora e popover
const MARGIN = 8;  // margine minimo dai bordi del viewport

/**
 * Popover ancorato e sempre visibile.
 * - Desktop: renderizzato in un portal con posizione `fixed` calcolata dal rect dell'ancora,
 *   con flip orizzontale/verticale e clamp ai bordi del viewport (non "scoppia" mai fuori schermo).
 * - Mobile: modale centrato con backdrop scuro e scroll interno.
 * Si chiude su click esterno (backdrop) o tasto ESC.
 */
export default function AnchoredPopover({ open, onClose, anchorRef, children, width = 320, align = "left", desktopMinWidth = 640 }: Props) {
  const popRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => setMounted(true), []);

  // Traccia desktop vs mobile (soglia configurabile, default sm = 640px)
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${desktopMinWidth}px)`);
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [desktopMinWidth]);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    const pop = popRef.current;
    if (!anchor || !pop) return;
    const r = anchor.getBoundingClientRect();
    const popW = pop.offsetWidth || width;
    const popH = pop.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Orizzontale: parte dall'allineamento preferito, poi clamp ai bordi
    let left = align === "right" ? r.right - popW : r.left;
    if (left + popW > vw - MARGIN) left = vw - popW - MARGIN;
    if (left < MARGIN) left = MARGIN;

    // Verticale: sotto l'ancora; se sfora in basso, prova sopra; infine clamp
    let top = r.bottom + GAP;
    if (top + popH > vh - MARGIN) {
      const above = r.top - GAP - popH;
      top = above >= MARGIN ? above : Math.max(MARGIN, vh - popH - MARGIN);
    }

    setCoords({ top, left });
  }, [anchorRef, align, width]);

  // Riposiziona all'apertura e su resize/scroll/cambio dimensione del popover.
  // Resta nascosto (visibility:hidden) finché coords non è impostato, quindi niente flash.
  useEffect(() => {
    if (!open || !isDesktop) { setCoords(null); return; }
    reposition();
    const onScroll = () => reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", onScroll, true);
    const ro = new ResizeObserver(() => reposition());
    if (popRef.current) ro.observe(popRef.current);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", onScroll, true);
      ro.disconnect();
    };
  }, [open, isDesktop, reposition]);

  // Chiusura con ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    isDesktop ? (
      <>
        {/* Backdrop trasparente: chiude al click fuori */}
        <div className="fixed inset-0 z-[70]" onClick={onClose} />
        <div
          ref={popRef}
          className="fixed z-[71] rounded-2xl shadow-2xl overflow-y-auto"
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            width,
            maxWidth: "calc(100vw - 16px)",
            maxHeight: "calc(100vh - 16px)",
            top: coords?.top ?? 0,
            left: coords?.left ?? 0,
            // resta nascosto finché non è posizionato, per evitare il "flash" in alto a sinistra
            visibility: coords ? "visible" : "hidden",
          }}
        >
          {children}
        </div>
      </>
    ) : (
      <>
        {/* Mobile: modale centrato con backdrop scuro */}
        <div className="fixed inset-0 z-[70] bg-black/30" onClick={onClose} />
        <div
          ref={popRef}
          className="fixed inset-x-3 top-1/2 -translate-y-1/2 z-[71] mx-auto max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl"
          style={{ background: "#fff", border: "1px solid #e5e7eb", maxWidth: width }}
        >
          {children}
        </div>
      </>
    ),
    document.body
  );
}
