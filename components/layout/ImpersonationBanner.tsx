"use client";

import { useState } from "react";
import { useAuth } from "@/components/layout/AuthProvider";

// Banner persistente mostrato su ogni pagina finché un admin sta
// impersonando un cliente/rappresentante ("Accedi come", admin/clienti).
// user.Impersonating arriva da /api/auth/profile, calcolato lato server
// controllando il cookie httpOnly spiezia_impersonator (mai leggibile qui).
export default function ImpersonationBanner() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  if (!user?.Impersonating) return null;

  async function handleReturn() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/impersonate/return", { method: "POST" });
      // Hard reload sempre: AuthProvider rilegge il profilo solo al mount,
      // un router.push non basterebbe a far sparire il banner/aggiornare il ruolo.
      window.location.href = res.ok ? "/" : "/login";
    } catch {
      window.location.href = "/login";
    }
  }

  return (
    <div
      className="w-full flex items-center justify-center gap-3 px-4 py-2 text-sm flex-shrink-0"
      style={{ background: "#111", color: "#FFC803", fontFamily: "var(--font-montserrat)" }}
    >
      <span>
        Stai visualizzando come <strong>{user.displayName || user.email}</strong>
      </span>
      <button
        onClick={handleReturn}
        disabled={loading}
        className="px-3 py-1 rounded-full text-xs font-bold transition-opacity disabled:opacity-60"
        style={{ background: "#FFC803", color: "#111" }}
      >
        {loading ? "…" : "Torna admin"}
      </button>
    </div>
  );
}
