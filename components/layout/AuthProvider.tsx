"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { AppUser } from "@/lib/types";

type AuthCtx = {
  user: AppUser | null;
  firebaseUser: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthCtx>({ user: null, firebaseUser: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        const snap = await getDoc(doc(db, "users", fbUser.uid));
        if (snap.exists()) {
          setUser({ uid: fbUser.uid, email: fbUser.email ?? "", ...snap.data() } as AppUser);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
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
