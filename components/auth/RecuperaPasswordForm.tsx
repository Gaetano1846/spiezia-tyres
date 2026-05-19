"use client";
import { useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import toast from "react-hot-toast";
import { Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function RecuperaPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setSent(true);
    } catch {
      toast.error("Email non trovata o errore nell'invio");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center space-y-4">
        <p className="text-sm text-[#111]">
          Email inviata a <strong>{email}</strong>. Controlla la tua casella di posta.
        </p>
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
          Email
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-[#E5E7EB] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#FFC300] transition-colors"
          placeholder="nome@spieziatyres.it"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-[#FFC300] hover:bg-[#E6B000] disabled:opacity-60 text-[#111] font-black py-3 rounded-xl flex items-center justify-center gap-2 text-sm transition-colors"
      >
        {loading ? <Loader2 size={18} className="animate-spin" /> : "Invia link di recupero"}
      </button>
      <div className="text-center">
        <Link href="/login" className="inline-flex items-center gap-1 text-xs text-[#9DA5AE] hover:text-[#111]">
          <ArrowLeft size={14} /> Torna al login
        </Link>
      </div>
    </form>
  );
}
