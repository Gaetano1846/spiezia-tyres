"use client";
import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

export function useUnreadNotifiche(uid: string | null): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!uid) { setCount(0); return; }

    const q = query(
      collection(db, "Notifiche"),
      where("Utente", "==", uid),
      where("Visto", "==", false)
    );

    const unsub = onSnapshot(q, (snap) => setCount(snap.size), () => setCount(0));
    return unsub;
  }, [uid]);

  return count;
}
