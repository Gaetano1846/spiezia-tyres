"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/layout/AuthProvider";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import toast from "react-hot-toast";
import {
  Home, ShoppingBag, User, FileText, Calendar,
  Wrench, Package, LogOut, ChevronRight, LayoutDashboard,
  Users, Truck, Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles?: string[];
  requireCRM?: boolean;
  group?: string;
};

const NAV: NavItem[] = [
  // B2B — tutti gli utenti autenticati
  { href: "/",           label: "Catalogo",       icon: <Home size={20} />,         group: "B2B" },
  { href: "/account",    label: "Il mio account", icon: <User size={20} />,         group: "B2B" },
  { href: "/ordini",     label: "I miei ordini",  icon: <ShoppingBag size={20} />,  group: "B2B" },

  // CRM — solo utenti con CRM=true
  { href: "/dashboard",        label: "Dashboard",      icon: <LayoutDashboard size={20} />, requireCRM: true, group: "CRM" },
  { href: "/clienti",          label: "Clienti",        icon: <Users size={20} />,           requireCRM: true, group: "CRM" },
  { href: "/preventivi",       label: "Preventivi",     icon: <FileText size={20} />,        requireCRM: true, group: "CRM" },
  { href: "/appuntamenti",     label: "Appuntamenti",   icon: <Calendar size={20} />,        requireCRM: true, group: "CRM" },
  { href: "/fogli-di-lavoro",  label: "Fogli di lavoro",icon: <Wrench size={20} />,          requireCRM: true, group: "CRM" },

  // Admin — solo Admin
  { href: "/admin/ordini",     label: "Ordini",         icon: <ShoppingBag size={20} />,  roles: ["Admin"], group: "Admin" },
  { href: "/admin/clienti",    label: "Clienti",        icon: <Users size={20} />,        roles: ["Admin"], group: "Admin" },
  { href: "/admin/prodotti",   label: "Prodotti",       icon: <Package size={20} />,      roles: ["Admin"], group: "Admin" },
  { href: "/admin/spedizioni", label: "Spedizioni",     icon: <Truck size={20} />,        roles: ["Admin"], group: "Admin" },
  { href: "/admin/email",      label: "Email",          icon: <Mail size={20} />,         roles: ["Admin"], group: "Admin" },

  // Magazzino
  { href: "/magazzino",  label: "Magazzino",      icon: <Package size={20} />,  roles: ["Admin","Magazziniere"], group: "Magazzino" },
];

const GROUP_LABELS: Record<string, string> = {
  B2B: "E-Commerce",
  CRM: "Officina",
  Admin: "Amministrazione",
  Magazzino: "Magazzino",
};

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
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

  const visible = NAV.filter((item) => {
    if (item.requireCRM && !user?.CRM) return false;
    if (item.roles && (!user?.Ruolo || !item.roles.includes(user.Ruolo))) return false;
    return true;
  });

  // Raggruppa gli item visibili per group
  const groups = visible.reduce<Record<string, NavItem[]>>((acc, item) => {
    const g = item.group ?? "B2B";
    if (!acc[g]) acc[g] = [];
    acc[g].push(item);
    return acc;
  }, {});

  return (
    <aside
      className="fixed inset-y-0 left-0 w-60 flex flex-col z-30"
      style={{ background: "#111111" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
        <Image src="/logo-lion.png" alt="Spiezia Tyres" width={40} height={40} className="object-contain" />
        <div>
          <p
            className="text-white font-bold text-sm leading-tight"
            style={{ fontFamily: "var(--font-poppins)" }}
          >
            Spiezia Tyres
          </p>
          <p className="text-[10px] text-white/40 uppercase tracking-widest">Gestionale</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group}>
            <p
              className="text-[10px] font-bold uppercase tracking-widest px-2 mb-2"
              style={{ color: "rgba(255,255,255,0.25)", fontFamily: "var(--font-montserrat)" }}
            >
              {GROUP_LABELS[group] ?? group}
            </p>
            <div className="space-y-1">
              {items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5 rounded-full text-sm font-medium transition-all",
                      active
                        ? "text-[#111] shadow-md"
                        : "text-white/60 hover:text-white hover:bg-white/8"
                    )}
                    style={
                      active
                        ? { background: "var(--brand)", fontFamily: "var(--font-montserrat)" }
                        : { fontFamily: "var(--font-montserrat)" }
                    }
                  >
                    <span className={active ? "text-[#111]" : ""}>{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    {active && <ChevronRight size={14} className="text-[#111]" />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer utente + logout */}
      <div className="px-4 py-4 border-t border-white/10">
        {user && (
          <div className="px-4 mb-3">
            <p className="text-xs text-white/60 font-semibold truncate" style={{ fontFamily: "var(--font-poppins)" }}>
              {user.email}
            </p>
            <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--brand)" }}>
              {user.Ruolo}
            </p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-full text-sm font-medium text-white/50 hover:text-white hover:bg-white/8 transition-all"
          style={{ fontFamily: "var(--font-montserrat)" }}
        >
          <LogOut size={20} />
          Esci
        </button>
      </div>
    </aside>
  );
}
