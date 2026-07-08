"use client";
import { useEffect, useState } from "react";

// Fase 6: Postgres via /api/notifiche/count invece di onSnapshot Firestore.
// Nessun realtime SSE ancora costruito — fetch singolo al mount, non uno
// stream. Nota: il filtro per uid (campo Utente) non è mai popolato nei dati
// reali (verificato campionando Firestore) — questo hook ritornava già 0
// prima della migrazione, stesso comportamento preservato.
export function useUnreadNotifiche(uid: string | null): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!uid) { setCount(0); return; }
    fetch(`/api/notifiche/count?uid=${encodeURIComponent(uid)}`)
      .then((r) => r.json())
      .then((d) => setCount(d.count ?? 0))
      .catch(() => setCount(0));
  }, [uid]);

  return count;
}
