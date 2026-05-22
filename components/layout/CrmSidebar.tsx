"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/layout/AuthProvider";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import toast from "react-hot-toast";
import { LayoutDashboard, Users, FileText, Wrench, LogOut, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard",       label: "Dashboard",       icon: LayoutDashboard },
  { href: "/clienti",         label: "Clienti",         icon: Users },
  { href: "/preventivi",      label: "Preventivi",      icon: FileText },
  { href: "/fogli-di-lavoro", label: "Fogli di Lavoro", icon: Wrench },
];

export default function CrmSidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const { user } = useAuth();

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      await signOut(auth);
      router.replace("/login");
    } catch {
      toast.error("Errore durante il logout");
    }
  }

  const initial = (user?.displayName || user?.email || "?")[0].toUpperCase();

  return (
    <aside
      className="fixed inset-y-0 left-0 w-[260px] flex flex-col z-30"
      style={{ background: "#fff", borderRight: "1px solid var(--border)" }}
    >
      {/* Logo */}
      <div className="flex items-center justify-center py-6 px-6" style={{ borderBottom: "1px solid var(--border)" }}>
        <Image
          src="/logo-spiezia.png"
          alt="Spiezia Tyres S.R.L."
          width={140}
          height={44}
          className="object-contain"
          unoptimized
        />
      </div>

      {/* User card */}
      <div className="flex flex-col items-center pt-7 pb-6 px-6" style={{ borderBottom: "1px solid var(--border)" }}>
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white mb-3 shadow-md"
          style={{ background: "#111" }}
        >
          {initial}
        </div>
        <p className="text-xs font-medium mb-0.5" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
          Nola
        </p>
        <p className="text-base font-bold leading-tight text-center" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
          {user?.Ruolo ?? "CRM"}
        </p>
        <p className="text-xs mt-1 text-center truncate max-w-[200px]" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
          {user?.displayName || user?.email || "—"}
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-2 px-5 pt-6">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center justify-center gap-2.5 w-full py-3 rounded-full text-sm font-semibold transition-all",
                active
                  ? "shadow-sm"
                  : "hover:bg-[#F1F4F8]"
              )}
              style={
                active
                  ? { background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)", border: "none" }
                  : { background: "#fff", color: "var(--text-primary)", fontFamily: "var(--font-montserrat)", border: "1.5px solid var(--border)" }
              }
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-5 space-y-2" style={{ borderTop: "1px solid var(--border)" }}>
        <Link
          href="/"
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-full text-sm font-medium transition-all hover:bg-[#F1F4F8]"
          style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)", border: "1.5px solid var(--border)" }}
        >
          <ArrowLeft size={15} />
          Vai al B2B
        </Link>
        <button
          onClick={handleLogout}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-full text-sm font-medium transition-all hover:bg-red-50"
          style={{ color: "#EF4444", fontFamily: "var(--font-montserrat)", border: "1.5px solid #FECACA" }}
        >
          <LogOut size={15} />
          Esci
        </button>
      </div>
    </aside>
  );
}
