"use client";
import { Bell } from "lucide-react";
import { useAuth } from "@/components/layout/AuthProvider";
import { useUnreadNotifiche } from "@/lib/hooks/useNotifiche";
import Link from "next/link";

export default function TopBar() {
  const { user } = useAuth();
  const unread = useUnreadNotifiche(user?.uid ?? null);

  return (
    <header className="h-14 bg-white border-b border-[#F0F0F0] flex items-center justify-end px-6 gap-4">
      <Link href="/notifiche" className="relative text-[#9DA5AE] hover:text-[#111] transition-colors">
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
    </header>
  );
}
