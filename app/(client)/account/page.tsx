"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signOut, updateProfile, sendPasswordResetEmail, onAuthStateChanged } from "firebase/auth";
import {
  collection, getDocs, doc, addDoc, setDoc, deleteDoc,
  limit, query, where, orderBy, type Timestamp,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  Download, MapPin, User, LogOut,
  Plus, Pencil, ArrowRight, CheckCircle, X, Trash2,
} from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";

type DocumentoOrdine = { Tipo: string; Link: string; Reference_Number?: string };

type DownloadItem = {
  ordineId: string;
  ordineNumero?: string;
  ordineData?: import("firebase/firestore").Timestamp;
  tipo: string;
  url: string;
};

// ─── Types ─────────────────────────────────────────────────────────────────────

type IndirizzoDoc = {
  id: string;
  Nome?: string;
  Cognome?: string;
  Azienda?: string;
  Via?: string;
  Civico?: string;
  CAP?: string;
  Citta?: string;
  Provincia?: string;
  Paese?: string;
  Telefono?: string;
};

type IndirizzoForm = Omit<IndirizzoDoc, "id">;

const EMPTY_FORM: IndirizzoForm = {
  Nome: "", Cognome: "", Azienda: "", Via: "", Civico: "",
  CAP: "", Citta: "", Provincia: "", Paese: "Italia", Telefono: "",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatData(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function initials(name?: string | null, email?: string | null): string {
  if (name && name.trim()) return name.trim()[0].toUpperCase();
  if (email) return email[0].toUpperCase();
  return "U";
}

const TABS = [
  { id: "download",  label: "Download",         icon: <Download size={15} /> },
  { id: "indirizzi", label: "Indirizzi",        icon: <MapPin size={15} /> },
  { id: "dettagli",  label: "Dettagli account", icon: <User size={15} /> },
  { id: "esci",      label: "Esci",             icon: <LogOut size={15} /> },
];

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function AccountPage() {
  const router = useRouter();
  const [tab, setTab] = useState("dettagli");

  const [uid, setUid] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  const [downloadItems, setDownloadItems] = useState<DownloadItem[]>([]);
  const [loadingDownload, setLoadingDownload] = useState(false);

  const [indirizziF, setIndirizziF] = useState<IndirizzoDoc[]>([]);
  const [indirizziS, setIndirizziS] = useState<IndirizzoDoc[]>([]);
  const [loadingIndirizzi, setLoadingIndirizzi] = useState(false);

  // Address modal state
  const [modal, setModal] = useState<{
    open: boolean;
    tipo: "fatturazione" | "spedizione";
    editing: IndirizzoDoc | null;
  }>({ open: false, tipo: "fatturazione", editing: null });
  const [form, setForm] = useState<IndirizzoForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [editName, setEditName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUid(user.uid);
        setUserEmail(user.email);
        setDisplayName(user.displayName);
        setEditName(user.displayName ?? "");
      } else {
        setUid(null);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!uid || tab !== "download") return;
    setLoadingDownload(true);
    const uRef = doc(db, "users", uid);
    getDocs(
      query(
        collection(db, "Ordini"),
        where("Utente", "==", uRef),
        orderBy("DataOra", "desc"),
        limit(100),
      ),
    ).then((snap) => {
      const items: DownloadItem[] = [];
      snap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const ordineNumero = (data.Numero as string | undefined);
        const ordineData = (data.DataOra ?? data.DataCreazione) as import("firebase/firestore").Timestamp | undefined;
        if (data.PDF && typeof data.PDF === "string") {
          items.push({ ordineId: d.id, ordineNumero, ordineData, tipo: "Fattura", url: data.PDF as string });
        }
        const docs = data.Documenti as DocumentoOrdine[] | undefined;
        docs?.forEach((doc_) => {
          if (doc_.Link) {
            items.push({ ordineId: d.id, ordineNumero, ordineData, tipo: doc_.Tipo ?? "Documento", url: doc_.Link });
          }
        });
      });
      setDownloadItems(items);
    })
      .catch(() => toast.error("Errore nel caricamento dei documenti"))
      .finally(() => setLoadingDownload(false));
  }, [uid, tab]);

  async function loadIndirizzi(userUid: string) {
    setLoadingIndirizzi(true);
    return Promise.all([
      getDocs(collection(db, "users", userUid, "Indirizzo_Fatturazione")),
      getDocs(collection(db, "users", userUid, "Indirizzo_Spedizione")),
    ])
      .then(([snapF, snapS]) => {
        setIndirizziF(snapF.docs.map((d) => ({ id: d.id, ...d.data() }) as IndirizzoDoc));
        setIndirizziS(snapS.docs.map((d) => ({ id: d.id, ...d.data() }) as IndirizzoDoc));
      })
      .catch(() => toast.error("Errore nel caricamento degli indirizzi"))
      .finally(() => setLoadingIndirizzi(false));
  }

  useEffect(() => {
    if (!uid || tab !== "indirizzi") return;
    loadIndirizzi(uid);
  }, [uid, tab]);

  function openNew(tipo: "fatturazione" | "spedizione") {
    setForm(EMPTY_FORM);
    setModal({ open: true, tipo, editing: null });
  }

  function openEdit(tipo: "fatturazione" | "spedizione", ind: IndirizzoDoc) {
    const { id, ...rest } = ind;
    setForm({ ...EMPTY_FORM, ...rest });
    setModal({ open: true, tipo, editing: ind });
  }

  function closeModal() {
    setModal((m) => ({ ...m, open: false }));
  }

  async function handleSaveAddress() {
    if (!uid) return;
    if (!form.Via?.trim() || !form.Citta?.trim()) {
      toast.error("Via e Città sono obbligatori");
      return;
    }
    setSaving(true);
    try {
      const subcol = modal.tipo === "fatturazione"
        ? "Indirizzo_Fatturazione"
        : "Indirizzo_Spedizione";
      const payload = Object.fromEntries(
        Object.entries(form).filter(([, v]) => typeof v === "string" && v.trim() !== "")
      );

      if (modal.editing) {
        await setDoc(doc(db, "users", uid, subcol, modal.editing.id), payload);
      } else {
        await addDoc(collection(db, "users", uid, subcol), payload);
      }

      toast.success(modal.editing ? "Indirizzo aggiornato" : "Indirizzo aggiunto");
      closeModal();
      await loadIndirizzi(uid);
    } catch (e) {
      console.error(e);
      toast.error("Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAddress() {
    if (!uid || !modal.editing) return;
    setDeleting(true);
    try {
      const subcol = modal.tipo === "fatturazione"
        ? "Indirizzo_Fatturazione"
        : "Indirizzo_Spedizione";
      await deleteDoc(doc(db, "users", uid, subcol, modal.editing.id));
      toast.success("Indirizzo eliminato");
      closeModal();
      await loadIndirizzi(uid);
    } catch {
      toast.error("Errore nell'eliminazione");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaveName() {
    if (!auth.currentUser) return;
    setSavingName(true);
    try {
      await updateProfile(auth.currentUser, { displayName: editName });
      setDisplayName(editName);
      toast.success("Nome aggiornato");
    } catch {
      toast.error("Errore nel salvataggio del nome");
    } finally {
      setSavingName(false);
    }
  }

  async function handleResetPassword() {
    if (!userEmail) return;
    try {
      await sendPasswordResetEmail(auth, userEmail);
      setResetSent(true);
      toast.success("Email di reset inviata");
    } catch {
      toast.error("Errore nell'invio dell'email");
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut(auth);
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
    } catch {
      toast.error("Errore durante il logout");
      setSigningOut(false);
    }
  }

  const initial = initials(displayName, userEmail);

  return (
    <div>
      {/* ── User header ── */}
      <div className="flex items-center gap-4 px-6 py-5" style={{ background: "#fff", borderBottom: "1px solid #e5e7eb" }}>
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
          style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-poppins)" }}
        >
          {initial}
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
            Il mio account
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
            {userEmail ?? "—"}
          </p>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div
        className="flex overflow-x-auto"
        style={{ background: "#fff", borderBottom: "2px solid #e5e7eb" }}
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-semibold whitespace-nowrap transition-all relative"
              style={{
                fontFamily: "var(--font-montserrat)",
                color: active ? "#111" : "#6b7280",
                background: active ? "#FFC803" : "transparent",
                borderBottom: active ? "2px solid #FFC803" : "2px solid transparent",
                marginBottom: -2,
              }}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Tab content ── */}
      <div className="px-4 md:px-6 py-6">

        {/* ── Download ── */}
        {tab === "download" && (
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)", background: "#fff", boxShadow: "var(--shadow-sm)" }}>
            <div className="overflow-x-auto">
            <div
              className="grid px-5 py-3 text-xs font-bold uppercase tracking-widest"
              style={{
                gridTemplateColumns: "160px 1fr 130px 120px",
                minWidth: 500,
                color: "#9ca3af",
                fontFamily: "var(--font-montserrat)",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              <span>Tipo</span>
              <span>Ordine</span>
              <span>Data</span>
              <span />
            </div>

            {loadingDownload ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="grid px-5 py-4 gap-4 animate-pulse"
                  style={{ gridTemplateColumns: "160px 1fr 130px 120px", minWidth: 500, borderBottom: "1px solid #f3f4f6" }}
                >
                  <div className="h-5 w-24 rounded-full" style={{ background: "#f3f4f6" }} />
                  <div className="h-4 w-28 rounded" style={{ background: "#f3f4f6" }} />
                  <div className="h-4 w-20 rounded" style={{ background: "#f3f4f6" }} />
                  <div className="h-7 w-24 rounded-full" style={{ background: "#f3f4f6" }} />
                </div>
              ))
            ) : downloadItems.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-3">
                <Download size={44} style={{ color: "#d1d5db" }} />
                <div className="text-center">
                  <p className="font-bold text-sm mb-1" style={{ fontFamily: "var(--font-poppins)", color: "#374151" }}>
                    Nessun documento disponibile
                  </p>
                  <p className="text-xs" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                    Le fatture e i documenti allegati agli ordini appariranno qui.
                  </p>
                </div>
                <Link
                  href="/prodotti"
                  className="flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold mt-2"
                  style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}
                >
                  Vai al negozio <ArrowRight size={15} />
                </Link>
              </div>
            ) : (
              downloadItems.map((item, idx) => (
                <div
                  key={`${item.ordineId}-${idx}`}
                  className="grid items-center px-5 py-4 hover:bg-[#FFFDF0] transition-colors"
                  style={{ gridTemplateColumns: "160px 1fr 130px 120px", minWidth: 500, borderBottom: "1px solid #f3f4f6" }}
                >
                  <span
                    className="text-xs font-bold px-2.5 py-1 rounded-full inline-block"
                    style={{ background: "#f0fdf4", color: "#16a34a", fontFamily: "var(--font-montserrat)", width: "fit-content" }}
                  >
                    {item.tipo}
                  </span>
                  <span
                    className="text-sm font-semibold px-2.5 py-1 rounded-lg inline-block"
                    style={{ background: "#f9fafb", fontFamily: "var(--font-poppins)", color: "#111", width: "fit-content" }}
                  >
                    {item.ordineNumero ?? `#${item.ordineId.slice(0, 8).toUpperCase()}`}
                  </span>
                  <span className="text-sm" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
                    {formatData(item.ordineData)}
                  </span>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                    style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)", width: "fit-content" }}
                  >
                    <Download size={12} /> Scarica
                  </a>
                </div>
              ))
            )}
            </div>
          </div>
        )}

        {/* ── Indirizzi ── */}
        {tab === "indirizzi" && (
          <div className="space-y-4">
            <div
              className="rounded-xl px-4 py-3 text-sm"
              style={{ background: "#fff", border: "1px solid #e5e7eb", color: "#6b7280", fontFamily: "var(--font-montserrat)" }}
            >
              I seguenti indirizzi saranno usati come predefiniti nella pagina di riepilogo dell&apos;ordine.
            </div>

            {loadingIndirizzi ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2].map((i) => (
                  <div key={i} className="rounded-2xl p-6 animate-pulse" style={{ background: "#fff", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
                    <div className="h-3 w-40 rounded mb-4" style={{ background: "#f3f4f6" }} />
                    <div className="space-y-2">
                      {[1, 2, 3].map((j) => <div key={j} className="h-3 w-full rounded" style={{ background: "#f3f4f6" }} />)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <IndirizzoPanel
                  title="Indirizzo di fatturazione"
                  indirizzi={indirizziF}
                  onAggiungi={() => openNew("fatturazione")}
                  onModifica={(ind) => openEdit("fatturazione", ind)}
                />
                <IndirizzoPanel
                  title="Indirizzo di spedizione"
                  indirizzi={indirizziS}
                  onAggiungi={() => openNew("spedizione")}
                  onModifica={(ind) => openEdit("spedizione", ind)}
                />
              </div>
            )}
          </div>
        )}

        {/* ── Dettagli account ── */}
        {tab === "dettagli" && (
          <div
            className="rounded-2xl p-6"
            style={{ background: "#fff", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}
          >
            <h2 className="font-bold text-base mb-6" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
              Dettagli account
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label
                  className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                  style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}
                >
                  Nome visualizzato
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none"
                    style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#111" }}
                  />
                  <button
                    onClick={handleSaveName}
                    disabled={savingName || editName === displayName}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 transition-opacity"
                    style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}
                  >
                    {savingName ? "…" : "Salva"}
                  </button>
                </div>
                <p className="text-xs mt-1.5" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                  Questo è il modo in cui il tuo nome verrà visualizzato nell&apos;account.
                </p>
              </div>

              <div>
                <label
                  className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                  style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}
                >
                  Indirizzo e-mail
                </label>
                <input
                  type="email"
                  readOnly
                  value={userEmail ?? "—"}
                  className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#6b7280" }}
                />
              </div>
            </div>

          </div>
        )}

        {/* ── Esci ── */}
        {tab === "esci" && (
          <div
            className="rounded-2xl py-14 flex flex-col items-center gap-5"
            style={{ border: "1px solid var(--border)", background: "#fff", boxShadow: "var(--shadow-sm)" }}
          >
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "#FEE2E2" }}>
              <LogOut size={28} style={{ color: "#991B1B" }} />
            </div>
            <div className="text-center">
              <p className="font-bold text-base mb-1" style={{ fontFamily: "var(--font-poppins)", color: "#374151" }}>
                Vuoi uscire?
              </p>
              <p className="text-sm" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                Verrai reindirizzato alla pagina di login.
              </p>
            </div>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="px-8 py-3 rounded-full font-bold text-sm disabled:opacity-60"
              style={{ background: "#EF4444", color: "#fff", fontFamily: "var(--font-montserrat)" }}
            >
              {signingOut ? "Uscita in corso…" : "Esci dall'account"}
            </button>
          </div>
        )}
      </div>

      {/* ── Address modal ── */}
      {modal.open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div
            className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl overflow-y-auto"
            style={{ background: "#fff", maxHeight: "90dvh" }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #e5e7eb" }}>
              <h2 className="font-bold text-base" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
                {modal.editing ? "Modifica" : "Aggiungi"} indirizzo di{" "}
                {modal.tipo === "fatturazione" ? "fatturazione" : "spedizione"}
              </h2>
              <button
                onClick={closeModal}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#f3f4f6] transition-colors"
              >
                <X size={16} style={{ color: "#6b7280" }} />
              </button>
            </div>

            {/* Form */}
            <div className="px-6 py-5 space-y-4">
              {/* Nome + Cognome */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nome" value={form.Nome ?? ""} onChange={(v) => setForm((f) => ({ ...f, Nome: v }))} />
                <Field label="Cognome" value={form.Cognome ?? ""} onChange={(v) => setForm((f) => ({ ...f, Cognome: v }))} />
              </div>

              {/* Azienda */}
              <Field label="Azienda (opzionale)" value={form.Azienda ?? ""} onChange={(v) => setForm((f) => ({ ...f, Azienda: v }))} />

              {/* Via + Civico */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <Field label="Via / Indirizzo *" value={form.Via ?? ""} onChange={(v) => setForm((f) => ({ ...f, Via: v }))} />
                </div>
                <Field label="Civico" value={form.Civico ?? ""} onChange={(v) => setForm((f) => ({ ...f, Civico: v }))} />
              </div>

              {/* CAP + Città + Provincia */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="CAP" value={form.CAP ?? ""} onChange={(v) => setForm((f) => ({ ...f, CAP: v }))} />
                <div className="sm:col-span-2">
                  <Field label="Città *" value={form.Citta ?? ""} onChange={(v) => setForm((f) => ({ ...f, Citta: v }))} />
                </div>
                <Field label="Prov." value={form.Provincia ?? ""} onChange={(v) => setForm((f) => ({ ...f, Provincia: v }))} maxLength={2} />
              </div>

              {/* Paese */}
              <Field label="Paese" value={form.Paese ?? "Italia"} onChange={(v) => setForm((f) => ({ ...f, Paese: v }))} />

              {/* Telefono */}
              <Field label="Telefono" value={form.Telefono ?? ""} onChange={(v) => setForm((f) => ({ ...f, Telefono: v }))} type="tel" />
            </div>

            {/* Actions */}
            <div
              className="flex items-center gap-3 px-6 py-4"
              style={{ borderTop: "1px solid #e5e7eb" }}
            >
              {modal.editing && (
                <button
                  onClick={handleDeleteAddress}
                  disabled={deleting}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                  style={{ background: "#FEE2E2", color: "#991B1B", fontFamily: "var(--font-montserrat)" }}
                >
                  <Trash2 size={14} /> {deleting ? "…" : "Elimina"}
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={closeModal}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: "#f9fafb", border: "1px solid #e5e7eb", color: "#374151", fontFamily: "var(--font-montserrat)" }}
              >
                Annulla
              </button>
              <button
                onClick={handleSaveAddress}
                disabled={saving}
                className="px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40"
                style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}
              >
                {saving ? "Salvataggio…" : "Salva indirizzo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Field helper ────────────────────────────────────────────────────────────

function Field({
  label, value, onChange, type = "text", maxLength,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; maxLength?: number;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
        style={{ background: "#f9fafb", border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)", color: "#111" }}
      />
    </div>
  );
}

// ─── Indirizzo panel ────────────────────────────────────────────────────────────

function IndirizzoPanel({
  title,
  indirizzi,
  onAggiungi,
  onModifica,
}: {
  title: string;
  indirizzi: IndirizzoDoc[];
  onAggiungi: () => void;
  onModifica: (ind: IndirizzoDoc) => void;
}) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)", background: "#fff", boxShadow: "var(--shadow-sm)" }}>
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: "1px solid #e5e7eb" }}
      >
        <h3
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}
        >
          {title}
        </h3>
        <button
          onClick={onAggiungi}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors hover:bg-[#FFF8DC]"
          style={{ border: "1.5px solid #FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
        >
          <Plus size={12} /> Aggiungi nuovo
        </button>
      </div>

      <div className="p-5">
        {indirizzi.length === 0 ? (
          <p className="text-sm" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
            Nessun indirizzo salvato.
          </p>
        ) : (
          <div className="space-y-4">
            {indirizzi.map((ind) => (
              <div key={ind.id}>
                <div className="text-sm space-y-0.5" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
                  {ind.Azienda && (
                    <p className="font-semibold" style={{ color: "#111" }}>{ind.Azienda}</p>
                  )}
                  <p className="font-semibold" style={{ color: "#111" }}>
                    {[ind.Nome, ind.Cognome].filter(Boolean).join(" ")}
                  </p>
                  {ind.Via && (
                    <p>{ind.Via}{ind.Civico ? `, ${ind.Civico}` : ""}</p>
                  )}
                  {(ind.CAP || ind.Citta) && (
                    <p>{ind.CAP} {ind.Citta}{ind.Provincia ? ` (${ind.Provincia})` : ""}</p>
                  )}
                  {ind.Paese && <p>{ind.Paese}</p>}
                  {ind.Telefono && <p>{ind.Telefono}</p>}
                </div>
                <button
                  onClick={() => onModifica(ind)}
                  className="flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors hover:bg-[#f3f4f6]"
                  style={{ border: "1px solid #e5e7eb", color: "#374151", fontFamily: "var(--font-montserrat)" }}
                >
                  <Pencil size={11} /> Modifica
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
