"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { AppUser, SessionPayload } from "@/lib/types";

type AuthCtx = {
  user: AppUser | null;
  firebaseUser: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthCtx>({ user: null, firebaseUser: null, loading: true });

function normalizeRuolo(raw: unknown): string {
  const s = String(raw ?? "Privato");
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

async function loadUserFromFirestore(uid: string, email: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  const data = snap.data();

  let SedeNome: string | undefined;
  if (data.Sede && typeof data.Sede === "object" && "path" in data.Sede) {
    try {
      const sedeSnap = await getDoc(data.Sede);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (sedeSnap.exists()) SedeNome = (sedeSnap.data() as any)?.Nome as string | undefined;
    } catch { /* sede non disponibile */ }
  }

  return {
    uid,
    email,
    ...data,
    Ruolo: normalizeRuolo(data.Ruolo),
    CRM: Boolean(data.CRM),
    ...(SedeNome ? { SedeNome } : {}),
  } as AppUser;
}

function hasRoleCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) => c.trim().startsWith("user-role="));
}

async function syncSessionCookie(fbUser: import("firebase/auth").User): Promise<void> {
  if (hasRoleCookie()) return;
  try {
    const idToken = await fbUser.getIdToken();
    await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
  } catch {
    // best-effort — middleware routing will fall back gracefully
  }
}

async function loadUserFromSession(): Promise<AppUser | null> {
  try {
    const res = await fetch("/api/auth/session");
    if (!res.ok) return null;
    const payload: SessionPayload = await res.json();
    if (!payload?.uid) return null;
    // Try to get the full Firestore doc; fall back to the session payload itself
    const snap = await getDoc(doc(db, "users", payload.uid));
    if (snap.exists()) return { uid: payload.uid, email: payload.email, ...snap.data() } as AppUser;
    // Dev preset users (dev-admin, dev-crm, …) don't exist in Firestore — build from payload
    return { uid: payload.uid, email: payload.email, Ruolo: payload.Ruolo, CRM: payload.CRM } as AppUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        syncSessionCookie(fbUser);
        const appUser = await loadUserFromFirestore(fbUser.uid, fbUser.email ?? "");
        setUser(appUser);
        setLoading(false);
      } else {
        // Firebase Auth has no session — try the server-side cookie (dev mode or prod session cookie)
        const appUser = await loadUserFromSession();
        setUser(appUser);
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  return (
    <AuthContext.Provider value={{ user, firebaseUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
