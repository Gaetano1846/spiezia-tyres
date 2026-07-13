"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";
import Link from "next/link";

export default function ImpostaNuovaPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("La password deve avere almeno 6 caratteri");
      return;
    }
    if (password !== confirm) {
      toast.error("Le password non coincidono");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Errore nel salvataggio");
      setDone(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Link scaduto o non valido");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="text-center space-y-4">
        <CheckCircle2 className="mx-auto text-[#16A34A]" size={40} />
        <p className="text-sm text-[#111]">Password aggiornata. Ora puoi accedere con la nuova password.</p>
        <Link href="/login" className="inline-flex items-center gap-1 text-xs text-[#9DA5AE] hover:text-[#111]">
          <ArrowLeft size={14} /> Torna al login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-[#9DA5AE] mb-1.5">
          Nuova password
        </label>
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-[#E5E7EB] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#FFC300] transition-colors"
          placeholder="Almeno 6 caratteri"
        />
      </div>
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-[#9DA5AE] mb-1.5">
          Conferma password
        </label>
        <input
          type="password"
          required
          minLength={6}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full border border-[#E5E7EB] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#FFC300] transition-colors"
          placeholder="Ripeti la password"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-[#FFC300] hover:bg-[#E6B000] disabled:opacity-60 text-[#111] font-black py-3 rounded-xl flex items-center justify-center gap-2 text-sm transition-colors"
      >
        {loading ? <Loader2 size={18} className="animate-spin" /> : "Imposta password"}
      </button>
      <div className="text-center">
        <Link href="/login" className="inline-flex items-center gap-1 text-xs text-[#9DA5AE] hover:text-[#111]">
          <ArrowLeft size={14} /> Torna al login
        </Link>
      </div>
    </form>
  );
}
