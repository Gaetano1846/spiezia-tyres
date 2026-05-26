"use client";
import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Phone, MessageCircle, Mail, Bell, ShoppingCart, Menu, Search, X } from "lucide-react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/layout/AuthProvider";
import { useCart } from "@/components/layout/CartProvider";

type ModalTipo = "cerchi" | "camere";

const CATEGORIA_MAP: Record<ModalTipo, string> = {
  cerchi: "Categoria_Prodotti/Cerchi Autocarro",
  camere: "Categoria_Prodotti/Camere D Aria",
};

type Props = {
  onMenuClick: () => void;
  onCartClick: () => void;
};

export default function B2BHeader({ onMenuClick, onCartClick }: Props) {
  const { user } = useAuth();
  const { count } = useCart();
  const router = useRouter();

  const [modal, setModal] = useState<{ tipo: ModalTipo | null; misura: string }>({
    tipo: null,
    misura: "",
  });

  // Conteggio notifiche non viste (stream real-time come Flutter)
  const [notifCount, setNotifCount] = useState(0);
  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, "Notifiche"), where("Visto", "==", false));
    const unsub = onSnapshot(q, (snap) => setNotifCount(snap.size), () => setNotifCount(0));
    return unsub;
  }, [user?.uid]);

  const ruolo = user?.Ruolo?.toLowerCase() ?? "";
  const isAdmin = ruolo === "admin";
  const hasCRM = user?.CRM || isAdmin;

  function openModal(tipo: ModalTipo) {
    setModal({ tipo, misura: "" });
  }

  function closeModal() {
    setModal({ tipo: null, misura: "" });
  }

  function handleCerca() {
    if (!modal.tipo) return;
    const params = new URLSearchParams();
    params.set("categoria", CATEGORIA_MAP[modal.tipo]);
    if (modal.misura.trim()) params.set("q", modal.misura.trim());
    router.push(`/prodotti?${params.toString()}`);
    closeModal();
  }

  const modalTitle =
    modal.tipo === "cerchi" ? "Ricerca Cerchi" : "Ricerca Camere D’Aria";

  return (
    <>
      <header className="sticky top-0 z-40" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.10)" }}>

        {/* ── Barra contatti (gialla) ── */}
        <div
          className="flex items-center justify-between px-5 py-1.5 text-xs"
          style={{ background: "#FFC803", fontFamily: "var(--font-montserrat)" }}
        >
          <div className="flex items-center gap-5" style={{ color: "#111" }}>
            <a href="tel:+390815115011" className="flex items-center gap-1.5 font-semibold hover:opacity-70 transition-opacity">
              <Phone size={11} />
              +39 081 511 5011
            </a>
            <a href="https://wa.me/390351009337" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-semibold hover:opacity-70 transition-opacity">
              <MessageCircle size={11} />
              +39 351 009 3370
            </a>
            <a href="mailto:b2b@spieziatyres.it" className="flex items-center gap-1.5 font-semibold hover:opacity-70 transition-opacity">
              <Mail size={11} />
              b2b@spieziatyres.it
            </a>
          </div>
          <div className="flex items-center gap-3" style={{ color: "#111" }}>
            <Link href="/notifiche" className="relative p-0.5">
              <Bell size={14} />
              {notifCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center"
                  style={{ background: "#111", color: "#FFC803" }}
                >
                  {notifCount > 9 ? "9+" : notifCount}
                </span>
              )}
            </Link>
            <span className="font-bold">V.2.0.0</span>
          </div>
        </div>

        {/* ── Header principale ── */}
        <div
          className="flex items-center gap-4 px-5 py-3"
          style={{ background: "#fff", borderBottom: "1px solid #e5e7eb" }}
        >
          {/* Sinistra: hamburger + CRM */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              onClick={onMenuClick}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              aria-label="Apri menu"
            >
              <Menu size={22} style={{ color: "#111" }} />
            </button>
            {hasCRM && (
              <Link
                href="/dashboard"
                className="text-xs font-bold px-3 py-1.5 rounded-full hover:opacity-80 transition-opacity"
                style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                CRM
              </Link>
            )}
          </div>

          {/* Centro: ricerca avanzata */}
          <div className="flex-1 flex items-center justify-center gap-2.5 flex-wrap">
            <span
              className="text-sm font-semibold hidden sm:inline"
              style={{ color: "#111", fontFamily: "var(--font-montserrat)" }}
            >
              Ricerca Avanzata:
            </span>

            {/* Pneumatici — naviga direttamente (categoria vuota = pneumatici) */}
            <Link
              href="/prodotti"
              className="text-xs font-semibold px-3 py-1.5 rounded-full transition-colors hover:bg-[#FFC803] hover:text-[#111]"
              style={{
                border: "1.5px solid #FFC803",
                color: "#111",
                fontFamily: "var(--font-montserrat)",
              }}
            >
              Pneumatici
            </Link>

            {/* Cerchi — apre modal */}
            <button
              onClick={() => openModal("cerchi")}
              className="text-xs font-semibold px-3 py-1.5 rounded-full transition-colors hover:bg-[#FFC803] hover:text-[#111]"
              style={{
                border: "1.5px solid #FFC803",
                color: "#111",
                fontFamily: "var(--font-montserrat)",
              }}
            >
              Cerchi
            </button>

            {/* Camere D'Aria — apre modal */}
            <button
              onClick={() => openModal("camere")}
              className="text-xs font-semibold px-3 py-1.5 rounded-full transition-colors hover:bg-[#FFC803] hover:text-[#111]"
              style={{
                border: "1.5px solid #FFC803",
                color: "#111",
                fontFamily: "var(--font-montserrat)",
              }}
            >
              Camere D&apos;Aria
            </button>
          </div>

          {/* Destra: Fido/Residuo + Logo + Carrello */}
          <div className="flex items-center gap-4 flex-shrink-0">

            {/* Fido / Fido_Residuo — visibile se l'utente ha un fido impostato */}
            {user?.Fido != null && user.Fido > 0 && (
              <div className="hidden md:flex flex-col gap-1">
                <div
                  className="flex items-center gap-2 px-3 py-1 rounded-lg text-xs"
                  style={{ border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)" }}
                >
                  <span className="font-bold" style={{ color: "#22c55e" }}>$</span>
                  <span>
                    Fido:{" "}
                    <strong>
                      {user.Fido.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}
                    </strong>
                  </span>
                </div>
                <div
                  className="flex items-center gap-2 px-3 py-1 rounded-lg text-xs"
                  style={{ border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)" }}
                >
                  <span
                    className="font-bold"
                    style={{
                      color:
                        user.Fido_Residuo != null && user.Fido_Residuo < user.Fido * 0.2
                          ? "#EF4444"
                          : "#9ca3af",
                    }}
                  >
                    $
                  </span>
                  <span
                    style={{
                      color:
                        user.Fido_Residuo != null && user.Fido_Residuo < user.Fido * 0.2
                          ? "#EF4444"
                          : "inherit",
                    }}
                  >
                    Residuo:{" "}
                    <strong>
                      {user.Fido_Residuo != null
                        ? user.Fido_Residuo.toLocaleString("it-IT", { style: "currency", currency: "EUR" })
                        : "—"}
                    </strong>
                  </span>
                </div>
              </div>
            )}

            {/* Logo */}
            <Link href="/" className="flex flex-col items-center gap-0.5 flex-shrink-0">
              <Image
                src="/logo-lion.png"
                alt="Spiezia Tyres"
                width={38}
                height={38}
                className="object-contain"
                unoptimized
              />
              <div className="text-center leading-none">
                <p
                  className="text-[8px] font-black uppercase tracking-wider"
                  style={{ color: "#111", fontFamily: "var(--font-poppins)" }}
                >
                  SPIEZIA
                </p>
                <p
                  className="text-[8px] font-black uppercase tracking-wider"
                  style={{ color: "#111", fontFamily: "var(--font-poppins)" }}
                >
                  TYRES S.P.A.
                </p>
              </div>
            </Link>

            {/* Carrello */}
            <button
              onClick={onCartClick}
              className="relative p-2 rounded-full hover:bg-gray-100 transition-colors"
              aria-label="Apri carrello"
            >
              <ShoppingCart size={22} style={{ color: "#111" }} />
              {count > 0 && (
                <span
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                  style={{ background: "#FFC803", color: "#111" }}
                >
                  {count}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ── Modal Ricerca Cerchi / Camere D'Aria ── */}
      {modal.tipo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={closeModal}
          />

          {/* Dialog */}
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            {/* Titolo */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Search size={20} style={{ color: "#FFC803" }} />
                <h2 className="text-base font-bold" style={{ color: "#111" }}>
                  {modalTitle}
                </h2>
              </div>
              <button
                onClick={closeModal}
                className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
                aria-label="Chiudi"
              >
                <X size={20} style={{ color: "#111" }} />
              </button>
            </div>

            {/* Input misura */}
            <input
              type="text"
              placeholder="Misura"
              value={modal.misura}
              onChange={(e) => setModal((p) => ({ ...p, misura: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleCerca()}
              className="w-full rounded-xl px-4 py-3 text-sm mb-4 outline-none"
              style={{
                border: "2px solid #FFC803",
                fontFamily: "var(--font-montserrat)",
              }}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />

            {/* Bottone Cerca */}
            <button
              onClick={handleCerca}
              className="w-full py-3 rounded-xl font-bold text-sm transition-opacity hover:opacity-85 active:opacity-70"
              style={{ background: "#FFC803", color: "#111" }}
            >
              Cerca
            </button>
          </div>
        </div>
      )}
    </>
  );
}
