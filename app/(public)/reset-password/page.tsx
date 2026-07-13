import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import ImpostaNuovaPasswordForm from "@/components/auth/ImpostaNuovaPasswordForm";

export const metadata: Metadata = { title: "Imposta nuova password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
      <Image src="/login-bg.png" alt="" fill className="object-cover" priority unoptimized />
      <div className="absolute inset-0 bg-black/55" />
      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, #000000 0%, transparent 60%)" }} />

      <div className="relative z-10 w-full max-w-[380px]">
        <div className="flex justify-center mb-8">
          <Image
            src="/logo-lion.png"
            alt="Spiezia Tyres"
            width={120}
            height={120}
            className="object-contain drop-shadow-xl"
          />
        </div>
        <div className="rounded-2xl p-8" style={{ background: "rgba(255,255,255,0.97)", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
          <h1 className="text-xl font-bold mb-2" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
            Imposta nuova password
          </h1>
          {token ? (
            <>
              <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
                Scegli una nuova password per il tuo account.
              </p>
              <ImpostaNuovaPasswordForm token={token} />
            </>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Link non valido.{" "}
              <Link href="/recupera-password" className="underline">
                Richiedi un nuovo link
              </Link>
              .
            </p>
          )}
        </div>
        <p className="text-center text-white/40 text-xs mt-6">
          © {new Date().getFullYear()} Spiezia Tyres S.p.A.
        </p>
      </div>
    </div>
  );
}
