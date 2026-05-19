"use client";
import { Bell, Search } from "lucide-react";
import { useAuth } from "@/components/layout/AuthProvider";
import { useUnreadNotifiche } from "@/lib/hooks/useNotifiche";
import Link from "next/link";

type Props = { title?: string };

export default function TopBar({ title }: Props) {
  const { user } = useAuth();
  const unread = useUnreadNotifiche(user?.uid ?? null);

  return (
    <header
      className="h-16 flex items-center justify-between px-6 gap-4 border-b"
      style={{ background: "#fff", borderColor: "var(--border)" }}
    >
      {title && (
        <h1
          className="text-lg font-bold"
          style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}
        >
          {title}
        </h1>
      )}

      <div className="flex-1" />

      {/* Search rapida */}
      <button className="flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-colors"
        style={{ background: "var(--bg-primary)", color: "var(--text-muted)" }}>
        <Search size={15} />
        <span className="hidden sm:inline" style={{ fontFamily: "var(--font-montserrat)" }}>Cerca…</span>
      </button>

      {/* Notifiche */}
      <Link href="/notifiche" className="relative p-2 rounded-full transition-colors hover:bg-[#F1F4F8]"
        style={{ color: "var(--text-muted)" }}>
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>

      {/* Avatar */}
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
        style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-poppins)" }}
        title={user?.email}
      >
        {user?.email?.[0]?.toUpperCase() ?? "?"}
      </div>
    </header>
  );
}
