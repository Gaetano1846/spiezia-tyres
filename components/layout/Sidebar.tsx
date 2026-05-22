"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/layout/AuthProvider";
import { useCart } from "@/components/layout/CartProvider";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import toast from "react-hot-toast";
import {
  Home, ShoppingBag, User, FileText, Calendar,
  Wrench, Package, LogOut, LayoutDashboard,
  Users, Truck, Mail, ShoppingCart, Tag, Percent, Image as ImageIcon, Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  roles?: string[];
  requireCRM?: boolean;
  group?: string;
};

const NAV: NavItem[] = [
  { href: "/",           label: "Catalogo",        icon: Home,         group: "B2B" },
  { href: "/account",    label: "Il mio account",  icon: User,         group: "B2B" },
  { href: "/ordini",     label: "I miei ordini",   icon: ShoppingBag,  group: "B2B" },
  { href: "/carrello",   label: "Carrello",         icon: ShoppingCart, group: "B2B" },

  { href: "/dashboard",        label: "Dashboard",       icon: LayoutDashboard, requireCRM: true, group: "CRM" },
  { href: "/clienti",          label: "Clienti",         icon: Users,           requireCRM: true, group: "CRM" },
  { href: "/preventivi",       label: "Preventivi",      icon: FileText,        requireCRM: true, group: "CRM" },
  { href: "/appuntamenti",     label: "Appuntamenti",    icon: Calendar,        requireCRM: true, group: "CRM" },
  { href: "/fogli-di-lavoro",  label: "Fogli di lavoro", icon: Wrench,          requireCRM: true, group: "CRM" },
  { href: "/notifiche",        label: "Notifiche",       icon: Bell,            requireCRM: true, group: "CRM" },

  { href: "/admin/ordini",     label: "Ordini",      icon: ShoppingBag,  roles: ["Admin"], group: "Admin" },
  { href: "/admin/clienti",    label: "Clienti",     icon: Users,        roles: ["Admin"], group: "Admin" },
  { href: "/admin/prodotti",   label: "Prodotti",    icon: Package,      roles: ["Admin"], group: "Admin" },
  { href: "/admin/brand",      label: "Brand",       icon: Tag,          roles: ["Admin"], group: "Admin" },
  { href: "/admin/promozioni", label: "Promozioni",  icon: Percent,      roles: ["Admin"], group: "Admin" },
  { href: "/admin/disegni",    label: "Disegni",     icon: ImageIcon,    roles: ["Admin"], group: "Admin" },
  { href: "/admin/spedizioni", label: "Spedizioni",  icon: Truck,        roles: ["Admin"], group: "Admin" },
  { href: "/admin/email",      label: "Email",       icon: Mail,         roles: ["Admin"], group: "Admin" },

  { href: "/magazzino", label: "Magazzino", icon: Package, roles: ["Admin", "Magazziniere"], group: "Magazzino" },
];

const GROUP_META: Record<string, { label: string; accent: string }> = {
  B2B:       { label: "E-Commerce",     accent: "#FFC803" },
  CRM:       { label: "Officina CRM",   accent: "#249689" },
  Admin:     { label: "Amministrazione",accent: "#EE8B60" },
  Magazzino: { label: "Magazzino",      accent: "#3B82F6" },
};

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const { user } = useAuth();
  const { count } = useCart();

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      await signOut(auth);
      router.replace("/login");
    } catch {
      toast.error("Errore durante il logout");
    }
  }

  const ruoloNorm = user?.Ruolo?.toLowerCase() ?? "";
  const isAdmin   = ruoloNorm === "admin";

  const visible = NAV.filter((item) => {
    // Admin vede tutto — incluse sezioni CRM indipendentemente dal flag CRM
    if (item.requireCRM && !user?.CRM && !isAdmin) return false;
    if (item.roles) {
      if (!user?.Ruolo) return false;
      // Confronto case-insensitive (il doc Firestore potrebbe avere "admin" lowercase)
      const rolesNorm = item.roles.map((r) => r.toLowerCase());
      if (!rolesNorm.includes(ruoloNorm)) return false;
    }
    return true;
  });

  const groups = visible.reduce<Record<string, NavItem[]>>((acc, item) => {
    const g = item.group ?? "B2B";
    if (!acc[g]) acc[g] = [];
    acc[g].push(item);
    return acc;
  }, {});

  const initial = (user?.displayName || user?.email || "?")[0].toUpperCase();

  return (
    <aside
      className="fixed inset-y-0 left-0 w-[240px] flex flex-col z-30 overflow-hidden"
      style={{ background: "#111111" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-[68px] flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <Image src="/logo-lion.png" alt="Spiezia Tyres" width={36} height={36} className="object-contain" unoptimized />
        <div>
          <p className="text-white font-bold text-sm leading-tight" style={{ fontFamily: "var(--font-poppins)" }}>
            Spiezia Tyres
          </p>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,200,3,0.7)" }}>
            {user?.Ruolo ?? "B2B"}
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {Object.entries(groups).map(([group, items]) => {
          const meta = GROUP_META[group] ?? { label: group, accent: "#FFC803" };
          return (
            <div key={group}>
              {/* Group header */}
              <div className="flex items-center gap-2 px-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: meta.accent }} />
                <p
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: "rgba(255,255,255,0.30)", fontFamily: "var(--font-montserrat)" }}
                >
                  {meta.label}
                </p>
                <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
              </div>

              {/* Items */}
              <div className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active =
                    pathname === item.href ||
                    (item.href !== "/" && pathname.startsWith(item.href));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                        active
                          ? "shadow-md"
                          : "hover:bg-white/[0.06]"
                      )}
                      style={
                        active
                          ? {
                              background: `${meta.accent}20`,
                              borderLeft: `3px solid ${meta.accent}`,
                              color: meta.accent,
                              fontFamily: "var(--font-montserrat)",
                            }
                          : {
                              color: "rgba(255,255,255,0.55)",
                              fontFamily: "var(--font-montserrat)",
                              borderLeft: "3px solid transparent",
                            }
                      }
                    >
                      <Icon size={17} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.href === "/carrello" && count > 0 && (
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: "var(--brand)", color: "#111" }}
                        >
                          {count}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 flex-shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        {user && (
          <div className="flex items-center gap-3 px-3 mb-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-[#111] flex-shrink-0"
              style={{ background: "var(--brand)" }}
            >
              {initial}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate" style={{ fontFamily: "var(--font-montserrat)" }}>
                {user.displayName || user.email}
              </p>
              <p className="text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>
                {user.Ruolo}
              </p>
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all hover:bg-white/[0.06]"
          style={{ color: "rgba(255,255,255,0.45)", fontFamily: "var(--font-montserrat)" }}
        >
          <LogOut size={17} />
          Esci
        </button>
      </div>
    </aside>
  );
}
