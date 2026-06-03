"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Menu, Bell } from "lucide-react";
import CrmSidebar from "@/components/layout/CrmSidebar";
import { useAuth } from "@/components/layout/AuthProvider";
import { useUnreadNotifiche } from "@/lib/hooks/useNotifiche";

export default function CrmShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const unread = useUnreadNotifiche(user?.uid ?? null);

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg-primary)" }}>
      <CrmSidebar open={open} onClose={() => setOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 md:ml-[260px]">
        {/* Top bar — solo mobile */}
        <header
          className="md:hidden sticky top-0 z-20 flex items-center justify-between h-14 px-4"
          style={{ background: "#fff", borderBottom: "1px solid var(--border)" }}
        >
          <button
            onClick={() => setOpen(true)}
            className="p-2 -ml-2 rounded-lg hover:bg-[#F1F4F8] transition-colors"
            aria-label="Apri menu"
          >
            <Menu size={22} style={{ color: "#111" }} />
          </button>

          <Image
            src="/logo-spiezia.png"
            alt="Spiezia Tyres"
            width={110}
            height={34}
            className="object-contain"
            unoptimized
          />

          <Link
            href="/notifiche"
            className="relative p-2 -mr-2 rounded-lg hover:bg-[#F1F4F8] transition-colors"
            aria-label="Notifiche"
          >
            <Bell size={20} style={{ color: "var(--text-muted)" }} />
            {unread > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
