"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import Link from "next/link";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        const { error } = await res.json();
        throw new Error(error ?? "Errore di autenticazione");
      }

      const { Ruolo, CRM } = await res.json();

      // Fork based on role — same logic as the Flutter app
      if (CRM) {
        router.replace("/dashboard");
      } else if (Ruolo === "Admin" || Ruolo === "Magazziniere") {
        router.replace("/admin/ordini");
      } else {
        router.replace("/");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Email o password errati";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-[#9DA5AE] mb-1.5">
          Email
        </label>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-[#E5E7EB] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#FFC300] transition-colors"
          placeholder="nome@spieziatyres.it"
        />
      </div>
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-[#9DA5AE] mb-1.5">
          Password
        </label>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-[#E5E7EB] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#FFC300] transition-colors"
          placeholder="••••••••"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-[#FFC300] hover:bg-[#E6B000] disabled:opacity-60 text-[#111] font-black py-3 rounded-xl flex items-center justify-center gap-2 text-sm transition-colors mt-2"
      >
        {loading ? <Loader2 size={18} className="animate-spin" /> : "Accedi"}
      </button>
      <div className="text-center pt-2">
        <Link href="/recupera-password" className="text-xs text-[#9DA5AE] hover:text-[#111] transition-colors">
          Password dimenticata?
        </Link>
      </div>
    </form>
  );
}
