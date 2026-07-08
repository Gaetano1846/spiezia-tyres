"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/layout/AuthProvider";
import { X } from "lucide-react";
import Link from "next/link";
import type { PopupApi } from "@/lib/popupDb";


export default function B2BPopUp() {
  const { user } = useAuth();
  const [queue,   setQueue]   = useState<PopupApi[]>([]);
  const [current, setCurrent] = useState<PopupApi | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;

    async function load() {
      const res = await fetch("/api/popup/active");
      if (!res.ok) return;
      const { popups } = await res.json() as { popups: PopupApi[] };
      if (popups.length > 0) {
        setCurrent(popups[0]);
        setQueue(popups.slice(1));
        setVisible(true);
      }
    }

    load().catch(() => {});
  }, [user?.uid]);

  async function dismiss() {
    if (!current || !user?.uid) return;

    // Mark popup as seen (fire-and-forget)
    fetch(`/api/popup/${current.id}/dismiss`, { method: "POST" }).catch(() => {});

    // Close then advance queue
    setVisible(false);
    setTimeout(() => {
      setQueue((prev) => {
        if (prev.length > 0) {
          setCurrent(prev[0]);
          setVisible(true);
          return prev.slice(1);
        }
        setCurrent(null);
        return [];
      });
    }, 280);
  }

  if (!visible || !current) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        style={{ background: "#fff" }}
      >
        {current.Immagine && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.Immagine}
            alt={current.Titolo}
            className="w-full max-h-64 object-cover"
          />
        )}

        <div className="p-6">
          <div className="flex items-start justify-between mb-3">
            <h2
              className="text-xl font-bold pr-4 leading-tight"
              style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}
            >
              {current.Titolo}
            </h2>
            <button
              onClick={dismiss}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
            >
              <X size={18} style={{ color: "var(--text-muted)" }} />
            </button>
          </div>

          {current.Descrizione && (
            <p
              className="text-sm leading-relaxed mb-5"
              style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
            >
              {current.Descrizione}
            </p>
          )}

          <div className="flex gap-3">
            {current.Link ? (
              <>
                <Link
                  href={current.Link}
                  onClick={dismiss}
                  className="flex-1 flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-bold transition-opacity hover:opacity-80"
                  style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
                >
                  {current.ButtonText || "Scopri di più"}
                </Link>
                <button
                  onClick={dismiss}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
                >
                  Chiudi
                </button>
              </>
            ) : (
              <button
                onClick={dismiss}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-opacity hover:opacity-80"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                {current.ButtonText || "Ho capito"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
