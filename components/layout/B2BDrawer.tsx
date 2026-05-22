"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Home, User, ShoppingBag, LayoutDashboard, Warehouse, LogOut, ChevronRight, X } from "lucide-react";
import { useAuth } from "@/components/layout/AuthProvider";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";

type Props = {
  open: boolean;
  onClose: () => void;
};

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles?: string[];
};

const NAV_ITEMS: NavItem[] = [
  { href: "/",           label: "Homepage",    icon: <Home size={20} /> },
  { href: "/account",    label: "Mio Account", icon: <User size={20} /> },
  { href: "/ordini",     label: "Miei Ordini", icon: <ShoppingBag size={20} /> },
  { href: "/dashboard",  label: "CRM",         icon: <LayoutDashboard size={20} />, roles: ["crm", "admin"] },
  { href: "/admin/ordini", label: "Backend",   icon: <LayoutDashboard size={20} />, roles: ["admin"] },
  { href: "/magazzino",  label: "Magazzino",   icon: <Warehouse size={20} />,       roles: ["admin", "magazziniere"] },
];

export default function B2BDrawer({ open, onClose }: Props) {
  const pathname = usePathname();
  const { user } = useAuth();
  const router = useRouter();

  const ruolo = user?.Ruolo?.toLowerCase() ?? "";
  const hasCRM = user?.CRM || ruolo === "admin";

  function visible(item: NavItem): boolean {
    if (!item.roles) return true;
    if (item.roles.includes("crm") && hasCRM) return true;
    return item.roles.includes(ruolo);
  }

  async function handleLogout() {
    try { await signOut(auth); } catch { /* ignore */ }
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <aside
        className="fixed inset-y-0 left-0 z-50 flex flex-col"
        style={{
          width: 280,
          background: "#fff",
          boxShadow: "4px 0 24px rgba(0,0,0,0.15)",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.25s cubic-bezier(.4,0,.2,1)",
        }}
      >
        {/* Header drawer */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid #e5e7eb" }}
        >
          <Link href="/" onClick={onClose} className="flex items-center gap-3">
            <Image
              src="/logo-lion.png"
              alt="Spiezia Tyres"
              width={36}
              height={36}
              className="object-contain"
              unoptimized
            />
            <div>
              <p className="text-sm font-black uppercase tracking-wider" style={{ color: "#111", fontFamily: "var(--font-poppins)", lineHeight: 1 }}>
                SPIEZIA
              </p>
              <p className="text-sm font-black uppercase tracking-wider" style={{ color: "#111", fontFamily: "var(--font-poppins)", lineHeight: 1 }}>
                TYRES S.P.A.
              </p>
            </div>
          </Link>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Chiudi menu"
          >
            <X size={20} style={{ color: "#111" }} />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-4 overflow-y-auto">
          {NAV_ITEMS.filter(visible).map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className="flex items-center gap-4 px-5 py-3.5 transition-colors"
                style={{
                  background: active ? "#FFF8DC" : "transparent",
                  borderLeft: active ? "4px solid #FFC803" : "4px solid transparent",
                  fontFamily: "var(--font-montserrat)",
                }}
              >
                <span style={{ color: active ? "#111" : "#6b7280" }}>{item.icon}</span>
                <span
                  className="flex-1 text-sm font-semibold"
                  style={{ color: active ? "#111" : "#374151" }}
                >
                  {item.label}
                </span>
                <ChevronRight size={16} style={{ color: "#9ca3af" }} />
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div style={{ borderTop: "1px solid #e5e7eb" }}>
          <button
            onClick={handleLogout}
            className="flex items-center gap-4 w-full px-5 py-4 hover:bg-gray-50 transition-colors"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            <LogOut size={20} style={{ color: "#ef4444" }} />
            <span className="text-sm font-semibold" style={{ color: "#ef4444" }}>Esci</span>
          </button>
        </div>
      </aside>
    </>
  );
}
