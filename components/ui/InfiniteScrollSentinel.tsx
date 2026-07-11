"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

// Elemento invisibile: quando entra nel viewport (scrollando verso il fondo
// lista/griglia) invoca onVisible. Usato per l'infinite-scroll al posto di
// un bottone "Carica altri" esplicito.
export default function InfiniteScrollSentinel({
  onVisible,
  hasMore,
  loading,
}: {
  onVisible: () => void;
  hasMore: boolean;
  loading: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onVisible();
      },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onVisible, hasMore]);

  if (!hasMore) return null;

  return (
    <div ref={ref} className="flex items-center justify-center py-4">
      {loading && <Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} />}
    </div>
  );
}
