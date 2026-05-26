"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import toast from "react-hot-toast";
import { Loader2, Eye, EyeOff } from "lucide-react";
import Link from "next/link";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await credential.user.getIdToken();

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Errore di autenticazione");
      }

      const { Ruolo, CRM } = await res.json();

      // Aggiorna lastLogin su Firestore (usato da admin clienti → "Ultimo accesso")
      try {
        await updateDoc(doc(db, "users", credential.user.uid), {
          lastLogin: serverTimestamp(),
        });
      } catch { /* non bloccare il login se il doc non esiste */ }

      // Admin va sempre all'area admin, indipendentemente dal flag CRM
      if (Ruolo === "Admin") router.replace("/admin/ordini");
      else if (Ruolo === "Magazziniere") router.replace("/magazzino");
      else if (CRM) router.replace("/dashboard");
      else router.replace("/");
    } catch (err: unknown) {
      if (err instanceof FirebaseError) console.error("[auth]", err.code, err.message);
      let msg = "Email o password errati";
      if (err instanceof FirebaseError) {
        switch (err.code) {
          case "auth/invalid-credential":
          case "auth/wrong-password":
          case "auth/user-not-found":
          case "auth/invalid-email":
            msg = "Email o password errati";
            break;
          case "auth/user-disabled":
            msg = "Account disabilitato. Contatta l'amministratore.";
            break;
          case "auth/too-many-requests":
            msg = "Troppi tentativi. Riprova tra qualche minuto.";
            break;
          case "auth/network-request-failed":
            msg = "Errore di rete. Controlla la connessione.";
            break;
          default:
            msg = `Errore di autenticazione (${err.code})`;
        }
      } else if (err instanceof Error) {
        msg = err.message;
      }
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "w-full border rounded-xl px-4 py-2.5 text-sm outline-none transition-colors bg-white " +
    "border-[#E0E3E7] focus:border-[#FFC803] placeholder:text-[#9DA5AE]";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          className="block text-xs font-semibold uppercase tracking-widest mb-1.5"
          style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
        >
          Email
        </label>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
          placeholder="nome@spieziatyres.it"
        />
      </div>

      <div>
        <label
          className="block text-xs font-semibold uppercase tracking-widest mb-1.5"
          style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
        >
          Password
        </label>
        <div className="relative">
          <input
            type={showPwd ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls + " pr-10"}
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPwd((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9DA5AE] hover:text-[#292929] transition-colors"
          >
            {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full text-[#111] font-bold py-2.5 rounded-full flex items-center justify-center gap-2 text-sm transition-all mt-2 disabled:opacity-60"
        style={{
          background: "var(--brand)",
          fontFamily: "var(--font-poppins)",
          boxShadow: "0 4px 16px rgba(255,200,3,0.4)",
        }}
      >
        {loading ? <Loader2 size={18} className="animate-spin" /> : "Log in"}
      </button>

      <div className="text-center pt-1">
        <Link
          href="/recupera-password"
          className="text-xs font-medium transition-colors"
          style={{ color: "#3B82F6" }}
        >
          Password dimenticata?
        </Link>
      </div>
    </form>
  );
}
