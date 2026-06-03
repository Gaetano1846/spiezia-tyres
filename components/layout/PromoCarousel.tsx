"use client";

import { useState, useEffect } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { X } from "lucide-react";

type PromoImg = {
  id: string;
  Url?: string;
  URL?: string;
  Immagine?: string;
  Copertina?: string;
  Ordine?: number;
  Attivo?: boolean;
};

// Immagine mostrata nella striscia (preferisce la "Copertina" banner, come nel vecchio gestionale Flutter)
function bannerSrc(p: PromoImg): string | undefined {
  return p.Copertina || p.Url || p.URL || p.Immagine;
}
// Immagine a piena risoluzione mostrata nello zoom
function fullSrc(p: PromoImg): string | undefined {
  return p.Url || p.URL || p.Immagine || p.Copertina;
}

/**
 * Carosello promozionale sempre presente sotto l'header (replica del banner "vicino all'header"
 * del precedente progetto Flutter / pagina ricerca prodotti).
 * - Sorgente: collezione Firestore `Promo_Immagini` con `Attivo != false`, ordinata per `Ordine`.
 * - Stile: striscia slim a scorrimento orizzontale di banner arrotondati, cliccabili per lo zoom.
 * - Se non ci sono promo attive, non renderizza nulla (nessun impatto sul layout).
 */
export default function PromoCarousel() {
  const [promo, setPromo] = useState<PromoImg[]>([]);
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    getDocs(collection(db, "Promo_Immagini"))
      .then((snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as PromoImg))
          .filter((p) => p.Attivo !== false) // mostra tutte salvo Attivo==false esplicito
          .sort((a, b) => (a.Ordine ?? 0) - (b.Ordine ?? 0));
        setPromo(items);
      })
      .catch(() => {});
  }, []);

  // Chiusura zoom con ESC
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setZoom(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  if (promo.length === 0) return null;

  return (
    <>
      <div className="flex-shrink-0" style={{ background: "#fff", borderBottom: "1px solid var(--border)" }}>
        <div
          className="flex items-center gap-3 overflow-x-auto overflow-y-hidden px-3 sm:px-4 py-2"
          style={{ scrollbarWidth: "thin", scrollbarColor: "#FFC803 transparent" }}
        >
          {promo.map((p) => {
            const src = bannerSrc(p);
            if (!src) return null;
            return (
              <button
                key={p.id}
                onClick={() => setZoom(fullSrc(p) || src)}
                className="flex-shrink-0 rounded-lg overflow-hidden transition-transform hover:scale-[1.02] active:scale-95"
                style={{ border: "1px solid var(--border)", background: "#f9fafb" }}
                title="Visualizza promozione"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="Promozione" className="h-14 sm:h-[72px] w-auto object-contain block" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Zoom modale */}
      {zoom && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setZoom(null)} />
          <div className="relative max-w-3xl w-full flex items-center justify-center">
            <button
              onClick={() => setZoom(null)}
              className="absolute -top-3 -right-3 z-10 w-9 h-9 rounded-full flex items-center justify-center shadow-lg"
              style={{ background: "#fff" }}
              aria-label="Chiudi"
            >
              <X size={18} style={{ color: "#111" }} />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={zoom} alt="Promozione" className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl" />
          </div>
        </div>
      )}
    </>
  );
}
