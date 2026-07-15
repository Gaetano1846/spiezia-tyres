"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2, Eye, EyeOff } from "lucide-react";
import Link from "next/link";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // Auth VPS-native — unico backend: core.auth_credentials/core.sessions
      // (vedi app/api/auth/login/route.ts). Nessun Firebase Auth lato client.
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Email o password errati");
      }

      const { Ruolo, CRM } = await res.json();

      // Solo redirect relativi same-origin: un valore esterno (es. ?redirect=https://evil…)
      // verrebbe altrimenti usato per phishing dopo un login legittimo.
      const rawRedirect = searchParams.get("redirect");
      const safeRedirect =
        rawRedirect && rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
          ? rawRedirect
          : null;
      const rolePath =
        Ruolo === "Admin" ? "/admin/ordini" :
        Ruolo === "Magazziniere" ? "/magazzino" :
        CRM ? "/dashboard" : "/";
      router.replace(safeRedirect ?? rolePath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Email o password errati";
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
