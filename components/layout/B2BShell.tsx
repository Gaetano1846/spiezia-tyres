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
  // In homepage il carosello promozionale è già presente nella parte inferiore della pagina: evitiamo il doppione sotto l'header
  const showPromoCarousel = pathname !== "/";

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "#f9fafb" }}>
      <B2BHeader
        onMenuClick={() => setDrawerOpen(true)}
        onCartClick={() => setCartOpen(true)}
      />
      {/* Carosello promozionale sotto l'header (replica del precedente progetto Flutter), nascosto in homepage per evitare il doppione */}
      {showPromoCarousel && <PromoCarousel />}
      <B2BDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
      <B2BPopUp />
      <main className="w-full flex-1 min-h-0 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
