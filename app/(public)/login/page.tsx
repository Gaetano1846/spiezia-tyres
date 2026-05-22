import type { Metadata } from "next";
import Image from "next/image";
import LoginForm from "@/components/auth/LoginForm";

export const metadata: Metadata = { title: "Accedi" };

export default function LoginPage() {
  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">

      {/* Background image con overlay scuro — uguale al login Flutter */}
      <Image
        src="/login-bg.png"
        alt=""
        fill
        className="object-cover"
        priority
        unoptimized
      />
      <div className="absolute inset-0 bg-black/50" />

      {/* Gradient overlay dal basso */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(to top, #000000 0%, transparent 60%)" }}
      />

      {/* Card centrale */}
      <div className="relative z-10 w-full max-w-[380px]">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Image
            src="/logo-lion.png"
            alt="Spiezia Tyres"
            width={120}
            height={120}
            className="object-contain drop-shadow-xl"
          />
        </div>

        <div
          className="rounded-2xl p-8"
          style={{
            background: "rgba(255,255,255,0.97)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          }}
        >
          <h1
            className="text-xl font-bold mb-1"
            style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}
          >
            Benvenuto
          </h1>
          <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
            Accedi al gestionale Spiezia Tyres
          </p>
          <LoginForm />
        </div>

        <p className="text-center text-white/40 text-xs mt-6">
          © {new Date().getFullYear()} Spiezia Tyres S.p.A.
        </p>
      </div>
    </div>
  );
}
