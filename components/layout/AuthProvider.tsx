"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { AppUser } from "@/lib/types";
import type { UtenteProfile } from "@/lib/utentiDb";

type AuthCtx = {
  user: AppUser | null;
  loading: boolean;
};

const AuthContext = createContext<AuthCtx>({ user: null, loading: true });

function normalizeRuolo(raw: unknown): AppUser["Ruolo"] {
  const s = String(raw ?? "Privato");
  return (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()) as AppUser["Ruolo"];
}

function toAppUser(p: UtenteProfile): AppUser {
  return {
    uid: p.uid,
    email: p.email ?? "",
    displayName: p.display_name ?? undefined,
    Ruolo: normalizeRuolo(p.Ruolo),
    CRM: Boolean(p.CRM),
    SedeNome: p.SedeNome ?? undefined,
    Fido: p.Fido ?? undefined,
    Fido_Residuo: p.Fido_Residuo ?? undefined,
    utentiAvvisati: p.UtentiAvvisati,
  };
}

// Auth VPS-native — l'unica fonte dello stato sessione lato client è
// /api/auth/profile (Postgres, vedi lib/utentiDb.ts::getUtenteProfile), che
// a sua volta legge la sessione da getSession() (cookie sp1_/dev). Niente più
// onAuthStateChanged/Firestore: il fallback Firebase è stato rimosso anche
// server-side (lib/auth.ts, app/api/auth/login/route.ts).
async function loadUser(): Promise<AppUser | null> {
  try {
    const res = await fetch("/api/auth/profile");
    if (!res.ok) return null;
    const profile = (await res.json()) as UtenteProfile;
    if (!profile?.uid) return null;
    return toAppUser(profile);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadUser().then((appUser) => {
      if (cancelled) return;
      setUser(appUser);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
