"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/layout/AuthProvider";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import toast from "react-hot-toast";
import {
  LayoutDashboard, ShoppingBag, Users, FileText, Calendar,
  Wrench, Package, LogOut, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles?: string[];
  requireCRM?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  // B2B
  { href: "/",           label: "Catalogo",        icon: <ShoppingBag size={18} /> },
  { href: "/account",    label: "Account",          icon: <Users size={18} /> },

  // CRM
  { href: "/dashboard",  label: "Dashboard",        icon: <LayoutDashboard size={18} />, requireCRM: true },
  { href: "/clienti",    label: "Clienti",          icon: <Users size={18} />, requireCRM: true },
  { href: "/preventivi", label: "Preventivi",       icon: <FileText size={18} />, requireCRM: true },
  { href: "/appuntamenti", label: "Appuntamenti",   icon: <Calendar size={18} />, requireCRM: true },
  { href: "/fogli-di-lavoro", label: "Fogli lavoro", icon: <Wrench size={18} />, requireCRM: true },

  // Admin
  { href: "/admin/ordini",     label: "Ordini",      icon: <ShoppingBag size={18} />, roles: ["Admin"] },
  { href: "/admin/clienti",    label: "Clienti admin", icon: <Users size={18} />, roles: ["Admin"] },
  { href: "/admin/prodotti",   label: "Prodotti",    icon: <Package size={18} />, roles: ["Admin"] },
  { href: "/admin/spedizioni", label: "Spedizioni",  icon: <Package size={18} />, roles: ["Admin"] },

  // Magazzino
  { href: "/magazzino",  label: "Magazzino",        icon: <Package size={18} />, roles: ["Admin", "Magazziniere"] },
];

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

  const visible = NAV_ITEMS.filter((item) => {
    if (item.requireCRM && !user?.CRM) return false;
    if (item.roles && (!user?.Ruolo || !item.roles.includes(user.Ruolo))) return false;
    return true;
  });

  return (
    <aside className="fixed inset-y-0 left-0 w-56 bg-[#111] flex flex-col z-30">
      <div className="px-5 py-6 border-b border-white/10">
        <span className="text-white font-black text-lg tracking-tight">
          Spiezia <span className="text-[#FFC300]">Tyres</span>
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {visible.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                active
                  ? "bg-[#FFC300] text-[#111]"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              )}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {active && <ChevronRight size={14} />}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-white/10">
        {user && (
          <div className="px-3 mb-3">
            <p className="text-xs text-white/40 truncate">{user.email}</p>
            <p className="text-xs text-white/60 font-medium">{user.Ruolo}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 transition-all"
        >
          <LogOut size={18} />
          Esci
        </button>
      </div>
    </aside>
  );
}
