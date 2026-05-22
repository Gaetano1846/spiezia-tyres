"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

export default function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Torna su"
      className="fixed bottom-6 right-6 z-50 flex items-center justify-center w-10 h-10 rounded-full shadow-lg transition-all hover:scale-110 active:scale-95"
      style={{ background: "var(--brand)", color: "#111" }}
    >
      <ArrowUp size={18} />
    </button>
  );
}
