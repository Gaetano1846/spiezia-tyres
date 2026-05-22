import type { Metadata } from "next";
import Image from "next/image";
import RecuperaPasswordForm from "@/components/auth/RecuperaPasswordForm";

export const metadata: Metadata = { title: "Recupera password" };

export default function RecuperaPasswordPage() {
  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
      <Image src="/login-bg.png" alt="" fill className="object-cover" priority unoptimized />
      <div className="absolute inset-0 bg-black/55" />
      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, #000000 0%, transparent 60%)" }} />

      <div className="relative z-10 w-full max-w-[380px]">
        <div className="flex justify-center mb-8">
          <Image
            src="/logo-spiezia.png"
            alt="Spiezia Tyres"
            width={200}
            height={60}
            className="object-contain drop-shadow-xl"
          />
        </div>
        <div className="rounded-2xl p-8" style={{ background: "rgba(255,255,255,0.97)", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
          <h1 className="text-xl font-bold mb-2" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
            Recupera password
          </h1>
          <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
            Inserisci la tua email e riceverai un link per reimpostare la password.
          </p>
          <RecuperaPasswordForm />
        </div>
        <p className="text-center text-white/40 text-xs mt-6">
          © {new Date().getFullYear()} Spiezia Tyres S.p.A.
        </p>
      </div>
    </div>
  );
}
