"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import B2BHeader from "@/components/layout/B2BHeader";
import B2BDrawer from "@/components/layout/B2BDrawer";
import CartDrawer from "@/components/layout/CartDrawer";
import B2BPopUp from "@/components/layout/B2BPopUp";
import PromoCarousel from "@/components/layout/PromoCarousel";

export default function B2BShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const pathname = usePathname();

  // La striscia carosello promozionale va mostrata SOLO nella ricerca pneumatici
  // (catalogo client `/prodotti`), non nel backend admin né nelle altre pagine.
  const showPromo = pathname === "/prodotti";

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "#f9fafb" }}>
      <B2BHeader
        onMenuClick={() => setDrawerOpen(true)}
        onCartClick={() => setCartOpen(true)}
      />
      <B2BDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
      <B2BPopUp />
      <main className="w-full flex-1 min-h-0 overflow-y-auto">
        {showPromo && <PromoCarousel />}
        {children}
      </main>
    </div>
  );
}
