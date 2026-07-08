"use client";
import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Phone, MessageCircle, Bell, ShoppingCart, Menu,
  Search, X, Flame, Snowflake,
} from "lucide-react";
import SearchableSelect from "@/components/ui/SearchableSelect";
import { searchProdotti } from "@/lib/algolia";
import { useAuth } from "@/components/layout/AuthProvider";
import { useCart } from "@/components/layout/CartProvider";

type ModalTipo = "pneumatici" | "cerchi" | "camere";

const CATEGORIA_MAP: Partial<Record<ModalTipo, string>> = {
  cerchi: "Categoria_Prodotti/Cerchi Autocarro",
  camere: "Categoria_Prodotti/Camere D Aria",
};

type ModalState = {
  tipo: ModalTipo | null;
  misura: string;
  marchio: string;
  indVelocita: string;
  stagioni: string[];
  accoppiata: boolean;
};

const MODAL_EMPTY: ModalState = {
  tipo: null, misura: "", marchio: "", indVelocita: "", stagioni: [], accoppiata: false,
};

const MARCHE = [
  "Michelin","Pirelli","Continental","Bridgestone","Goodyear",
  "Hankook","Yokohama","Dunlop","Falken","BFGoodrich","Toyo",
  "Kumho","Starmaxx","Kormoran","Nexen","Apollo","Compasal",
];

const INDICI_VELOCITA = ["P","Q","R","S","T","H","V","W","Y","Z"];
const INDICI_CARICO   = Array.from({ length: 50 }, (_, i) => String(60 + i)); // 60..109

const STAGIONI = [
  { key: "Estive",     icon: "flame",     label: "Estive" },
  { key: "4 Stagioni", icon: "4stagioni", label: "4 Stagioni" },
  { key: "Invernali",  icon: "snowflake", label: "Invernali" },
] as const;

type Props = {
  onMenuClick: () => void;
  onCartClick: () => void;
};

export default function B2BHeader({ onMenuClick, onCartClick }: Props) {
  const { user } = useAuth();
  const { count } = useCart();
  const router    = useRouter();
  const pathname  = usePathname();

  // Header search state
  const [cerca,          setCerca]          = useState("");
  const [marca,          setMarca]          = useState("");
  const [indiceVelocita, setIndiceVelocita] = useState("");
  const [indiceCarico,   setIndiceCarico]   = useState("");
  const [stagioni,       setStagioni]       = useState<string[]>([]);

  // Modal pneumatici / cerchi / camere
  const [modal, setModal] = useState<ModalState>(MODAL_EMPTY);

  // Marche disponibili (caricate da Algolia, fallback sulla lista statica)
  const [marcheAll, setMarcheAll] = useState<string[]>(MARCHE);
  useEffect(() => {
    searchProdotti({ withFacets: true, hitsPerPage: 1, soloDisponibili: false })
      .then((r) => {
        if (r.facets?.Marca) setMarcheAll(Object.keys(r.facets.Marca).sort());
      })
      .catch(() => {});
  }, []);

  // Notifiche non viste (conteggio globale, non per-utente — Fase 6: Postgres via /api/notifiche/count)
  const [notifCount, setNotifCount] = useState(0);
  useEffect(() => {
    if (!user?.uid) return;
    fetch("/api/notifiche/count")
      .then((r) => r.json())
      .then((d) => setNotifCount(d.count ?? 0))
      .catch(() => setNotifCount(0));
  }, [user?.uid]);

  const ruolo   = user?.Ruolo?.toLowerCase() ?? "";
  const isAdmin = ruolo === "admin";
  const hasCRM  = user?.CRM || isAdmin;

  // Barra filtri pneumatici persistente sulle pagine secondarie (come nell'app Flutter).
  // Eccezioni: la homepage (ha già l'hero di ricerca completo al centro) e le pagine
  // prodotti (lista + dettaglio), che hanno i propri criteri di filtro dedicati alla lista.
  const isProdottiPage = pathname === "/prodotti" || pathname.startsWith("/prodotti/");
  const showSearch = pathname !== "/" && !isProdottiPage;

  function toggleStagione(s: string) {
    setStagioni((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  function handleHeaderSearch() {
    const params = new URLSearchParams();
    if (cerca.trim())       params.set("q",       cerca.trim());
    if (marca)              params.set("marca",    marca);
    if (indiceVelocita)     params.set("iv",       indiceVelocita);
    if (indiceCarico)       params.set("ic",       indiceCarico);
    if (stagioni.length > 0) params.set("stagione", stagioni.join(","));
    router.push(`/prodotti?${params.toString()}`);
  }

  function openModal(tipo: ModalTipo) { setModal({ ...MODAL_EMPTY, tipo }); }
  function closeModal()               { setModal(MODAL_EMPTY); }

  function toggleModalStagione(s: string) {
    setModal((p) => ({
      ...p,
      stagioni: p.stagioni.includes(s) ? p.stagioni.filter((x) => x !== s) : [...p.stagioni, s],
    }));
  }

  function handleCercaModal() {
    if (!modal.tipo) return;
    const params = new URLSearchParams();
    if (modal.tipo === "pneumatici") {
      if (modal.misura.trim())       params.set("q",        modal.misura.trim());
      if (modal.marchio)             params.set("marca",    modal.marchio);
      if (modal.indVelocita)         params.set("iv",       modal.indVelocita);
      if (modal.stagioni.length > 0) params.set("stagione", modal.stagioni.join(","));
      if (modal.accoppiata)          params.set("accoppiata", "true");
    } else {
      const cat = CATEGORIA_MAP[modal.tipo];
      if (cat) params.set("categoria", cat);
      if (modal.misura.trim()) params.set("q", modal.misura.trim());
    }
    const qs = params.toString();
    router.push(qs ? `/prodotti?${qs}` : "/prodotti");
    closeModal();
  }

  const modalTitle =
    modal.tipo === "pneumatici" ? "Ricerca Pneumatici" :
    modal.tipo === "cerchi"     ? "Ricerca Cerchi" :
                                  "Ricerca Camere D’Aria";

  return (
    <>
      <header className="sticky top-0 z-40" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.10)" }}>

        {/* ── Barra contatti (gialla) ── */}
        <div
          className="flex items-center justify-between px-3 sm:px-5 py-1 sm:py-1.5 text-xs"
          style={{ background: "#FFC803", fontFamily: "var(--font-montserrat)" }}
        >
          <div className="flex items-center gap-3 sm:gap-5 min-w-0" style={{ color: "#111" }}>
            <a href="tel:+390815115011" className="flex items-center gap-1.5 font-semibold hover:opacity-70 transition-opacity">
              <Phone size={11} className="flex-shrink-0" /> <span className="hidden sm:inline">+39 081 511 5011</span>
            </a>
            <a href="https://wa.me/390351009337" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-semibold hover:opacity-70 transition-opacity">
              <MessageCircle size={11} className="flex-shrink-0" /> <span className="hidden sm:inline">+39 351 009 3370</span>
            </a>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0" style={{ color: "#111" }}>
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

        {/* ── Header principale — riga 1 ── */}
        <div
          className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-2 sm:py-2.5"
          style={{ background: "#fff", borderBottom: "none" }}
        >
          {/* Sinistra: hamburger + CRM */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <button onClick={onMenuClick} className="p-2 rounded-lg hover:bg-gray-100 transition-colors" aria-label="Apri menu">
              <Menu size={22} style={{ color: "#111" }} />
            </button>
            {hasCRM && (
              <Link
                href="/dashboard"
                className="text-xs font-bold px-3 py-1 sm:py-1.5 rounded-full hover:opacity-80 transition-opacity"
                style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                CRM
              </Link>
            )}
          </div>

          {/* Spaziatore — solo mobile (il cluster Ricerca Avanzata è nascosto) */}
          <div className="flex-1 md:hidden" />

          {/* Centro: Ricerca Avanzata — da tablet in su */}
          <div className="hidden md:flex flex-1 items-center justify-center gap-2 flex-wrap">
            <span className="text-xs font-semibold hidden md:inline" style={{ color: "#111", fontFamily: "var(--font-montserrat)" }}>
              Ricerca Avanzata:
            </span>
            <button
              onClick={() => openModal("pneumatici")}
              className="text-xs font-semibold px-3 py-1.5 rounded-full transition-colors hover:bg-[#FFC803] hover:text-[#111]"
              style={{ border: "1.5px solid #FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
            >
              Pneumatici
            </button>
            <button
              onClick={() => openModal("cerchi")}
              className="text-xs font-semibold px-3 py-1.5 rounded-full transition-colors hover:bg-[#FFC803] hover:text-[#111]"
              style={{ border: "1.5px solid #FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
            >
              Cerchi
            </button>
            <button
              onClick={() => openModal("camere")}
              className="text-xs font-semibold px-3 py-1.5 rounded-full transition-colors hover:bg-[#FFC803] hover:text-[#111]"
              style={{ border: "1.5px solid #FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
            >
              Camere D&apos;Aria
            </button>
          </div>

          {/* Destra: Fido + Logo + Carrello */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {user?.Fido != null && user.Fido > 0 && (
              <div className="hidden lg:flex flex-col gap-0.5">
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
                  style={{ border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)" }}
                >
                  <span className="font-bold" style={{ color: "#22c55e" }}>$</span>
                  <span>Fido: <strong>{user.Fido.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</strong></span>
                </div>
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
                  style={{ border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)" }}
                >
                  <span className="font-bold" style={{ color: user.Fido_Residuo != null && user.Fido_Residuo < user.Fido * 0.2 ? "#EF4444" : "#9ca3af" }}>$</span>
                  <span style={{ color: user.Fido_Residuo != null && user.Fido_Residuo < user.Fido * 0.2 ? "#EF4444" : "inherit" }}>
                    Residuo: <strong>
                      {user.Fido_Residuo != null ? user.Fido_Residuo.toLocaleString("it-IT", { style: "currency", currency: "EUR" }) : "—"}
                    </strong>
                  </span>
                </div>
              </div>
            )}

            <Link href="/" className="flex flex-col items-center gap-0.5 flex-shrink-0">
              <Image src="/logo-lion.png" alt="Spiezia Tyres" width={38} height={38} className="object-contain" unoptimized />
              <div className="text-center leading-none">
                <p className="text-[8px] font-black uppercase tracking-wider" style={{ color: "#111", fontFamily: "var(--font-poppins)" }}>SPIEZIA</p>
                <p className="text-[8px] font-black uppercase tracking-wider" style={{ color: "#111", fontFamily: "var(--font-poppins)" }}>TYRES S.P.A.</p>
              </div>
            </Link>

            <button onClick={onCartClick} className="relative p-2 rounded-full hover:bg-gray-100 transition-colors" aria-label="Apri carrello">
              <ShoppingCart size={22} style={{ color: "#111" }} />
              {count > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: "#FFC803", color: "#111" }}>
                  {count}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* ── Ricerca Avanzata — riga dedicata solo su mobile ── */}
        <div
          className="md:hidden flex items-center gap-1.5 px-3 pb-1.5 pt-0 overflow-x-auto no-scrollbar"
          style={{ background: "#fff" }}
        >
          <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
            Ricerca:
          </span>
          {([
            ["pneumatici", "Pneumatici"],
            ["cerchi", "Cerchi"],
            ["camere", "Camere D'Aria"],
          ] as [ModalTipo, string][]).map(([tipo, label]) => (
            <button
              key={tipo}
              onClick={() => openModal(tipo)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors flex-shrink-0 active:bg-[#FFC803]"
              style={{ border: "1.5px solid #FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Filtri rapidi (nascosti su homepage e prodotti) ── */}
        {showSearch && (
          <div
            className="flex items-center gap-2 px-3 sm:px-5 pb-2 sm:pb-3 pt-0 sm:pt-1 overflow-x-auto no-scrollbar"
            style={{ background: "#fff", borderBottom: "1px solid #e5e7eb" }}
          >
            {/* Campo testo */}
            <div className="relative flex-shrink-0 w-40">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#9ca3af" }} />
              <input
                value={cerca}
                onChange={(e) => setCerca(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleHeaderSearch()}
                placeholder="Cerca..."
                className="w-full pl-8 pr-3 py-2 text-sm outline-none rounded-xl"
                style={{ border: "1.5px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#111" }}
              />
            </div>

            {/* Marchio */}
            <div className="flex-shrink-0" style={{ width: 145 }}>
              <SearchableSelect
                value={marca}
                onChange={setMarca}
                options={marcheAll}
                placeholder="Marchio"
                style={{ fontSize: 13 }}
              />
            </div>

            {/* Indice di Velocità */}
            <div className="flex-shrink-0" style={{ width: 130 }}>
              <SearchableSelect
                value={indiceVelocita}
                onChange={setIndiceVelocita}
                options={INDICI_VELOCITA}
                placeholder="Indice vel."
                style={{ fontSize: 13 }}
              />
            </div>

            {/* Indice di Carico */}
            <div className="flex-shrink-0" style={{ width: 130 }}>
              <SearchableSelect
                value={indiceCarico}
                onChange={setIndiceCarico}
                options={INDICI_CARICO}
                placeholder="Indice car."
                style={{ fontSize: 13 }}
              />
            </div>

            {/* Stagioni */}
            {STAGIONI.map((s) => {
              const active = stagioni.includes(s.key);
              return (
                <button
                  key={s.key}
                  onClick={() => toggleStagione(s.key)}
                  title={s.label}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl text-xs font-semibold transition-all flex-shrink-0"
                  style={{
                    border: `1.5px solid ${active ? "#FFC803" : "#e5e7eb"}`,
                    background: active ? "#FFF8DC" : "#fff",
                    color: active ? "#111" : "#6b7280",
                    fontFamily: "var(--font-montserrat)",
                  }}
                >
                  {s.icon === "flame"     && <Flame     size={12} style={{ color: active ? "#EF4444" : "#9ca3af" }} />}
                  {s.icon === "4stagioni" && <Image src="/icon-4stagioni.png" width={12} height={12} alt="4 stagioni" unoptimized />}
                  {s.icon === "snowflake" && <Snowflake size={12} style={{ color: active ? "#3B82F6" : "#9ca3af" }} />}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
              );
            })}

            {/* Tutte — azzera il filtro stagione (replica app Flutter) */}
            <button
              onClick={() => setStagioni([])}
              title="Tutte le stagioni"
              className="px-2.5 py-2 rounded-xl text-xs font-semibold transition-colors flex-shrink-0 hover:bg-gray-100"
              style={{
                border: `1.5px solid ${stagioni.length === 0 ? "#FFC803" : "#e5e7eb"}`,
                background: stagioni.length === 0 ? "#FFF8DC" : "#fff",
                color: "#111",
                fontFamily: "var(--font-montserrat)",
              }}
            >
              Tutte
            </button>

            {/* Bottone Cerca */}
            <button
              onClick={handleHeaderSearch}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-opacity hover:opacity-80 flex-shrink-0"
              style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
            >
              <Search size={14} />
              Cerca
            </button>
          </div>
        )}
      </header>

      {/* ── Modal Ricerca ── */}
      {modal.tipo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" style={{ fontFamily: "var(--font-montserrat)" }}>

            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Search size={20} style={{ color: "#FFC803" }} />
                <h2 className="text-base font-bold" style={{ color: "#111" }}>{modalTitle}</h2>
              </div>
              <button onClick={closeModal} className="p-1 rounded-lg hover:bg-gray-100 transition-colors" aria-label="Chiudi">
                <X size={20} style={{ color: "#111" }} />
              </button>
            </div>

            {/* ── Pneumatici ── */}
            {modal.tipo === "pneumatici" && (
              <>
                {/* Riga 1: Misura + Marchio */}
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    placeholder="Es. 2055516"
                    value={modal.misura}
                    onChange={(e) => setModal((p) => ({ ...p, misura: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && handleCercaModal()}
                    className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
                    style={{ border: "2px solid #FFC803" }}
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                  />
                  <div style={{ minWidth: 120 }}>
                    <SearchableSelect
                      value={modal.marchio}
                      onChange={(v) => setModal((p) => ({ ...p, marchio: v }))}
                      options={marcheAll}
                      placeholder="Marchio"
                    />
                  </div>
                </div>

                {/* Riga 2: Indice velocità + stagioni */}
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex-1">
                    <SearchableSelect
                      value={modal.indVelocita}
                      onChange={(v) => setModal((p) => ({ ...p, indVelocita: v }))}
                      options={INDICI_VELOCITA}
                      placeholder="Indice di Velocità"
                    />
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {STAGIONI.map((s) => {
                      const active = modal.stagioni.includes(s.key);
                      return (
                        <button
                          key={s.key}
                          onClick={() => toggleModalStagione(s.key)}
                          title={s.label}
                          className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
                          style={{
                            border: `2px solid ${active ? "#FFC803" : "#e5e7eb"}`,
                            background: active ? "#FFF8DC" : "#fff",
                          }}
                        >
                          {s.icon === "flame"     && <Flame     size={13} style={{ color: active ? "#EF4444" : "#9ca3af" }} />}
                          {s.icon === "4stagioni" && <Image src="/icon-4stagioni.png" width={14} height={14} alt="4 stagioni" unoptimized />}
                          {s.icon === "snowflake" && <Snowflake size={13} style={{ color: active ? "#3B82F6" : "#9ca3af" }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Accoppiata */}
                <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={modal.accoppiata}
                    onChange={(e) => setModal((p) => ({ ...p, accoppiata: e.target.checked }))}
                    className="w-4 h-4 rounded accent-[#FFC803]"
                  />
                  <span className="text-sm font-semibold" style={{ color: "#111" }}>Accoppiata</span>
                </label>
              </>
            )}

            {/* ── Cerchi / Camere ── */}
            {modal.tipo !== "pneumatici" && (
              <input
                type="text"
                placeholder="Misura"
                value={modal.misura}
                onChange={(e) => setModal((p) => ({ ...p, misura: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && handleCercaModal()}
                className="w-full rounded-xl px-4 py-3 text-sm mb-4 outline-none"
                style={{ border: "2px solid #FFC803" }}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
            )}

            <button
              onClick={handleCercaModal}
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
