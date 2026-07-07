"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Clienti",     href: "/admin/clienti" },
  { label: "Ordini",      href: "/admin/ordini" },
  { label: "Spedizioni",  href: "/admin/spedizioni" },
  { label: "Promozioni",  href: "/admin/promozioni" },
  { label: "Brand",       href: "/admin/brand" },
  { label: "Disegni",     href: "/admin/disegni" },
  { label: "Email",       href: "/admin/email" },
  { label: "Operatori",   href: "/admin/operatori" },
  { label: "Sedi",        href: "/admin/sedi" },
  { label: "Catalogo",   href: "/admin/catalogo" },
  { label: "Banner",     href: "/admin/banner" },
  { label: "Pop-Up",    href: "/admin/popup" },
];

export default function BackendTabs() {
  const pathname = usePathname();

  return (
    <div
      className="w-full overflow-x-auto"
      style={{ background: "#fff", borderBottom: "1px solid #e5e7eb" }}
    >
      <div className="flex items-center min-w-max px-4">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="relative px-4 py-3 text-xs font-bold uppercase tracking-wide transition-colors whitespace-nowrap"
              style={{
                color: active ? "#111" : "#6b7280",
                fontFamily: "var(--font-montserrat)",
              }}
            >
              {tab.label}
              {active && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                  style={{ background: "#FFC803" }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
