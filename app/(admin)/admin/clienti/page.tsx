"use client";

import { useState, useEffect, useMemo } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
  getDoc,
  doc,
  type Timestamp,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Users,
  Search,
  CreditCard,
  Building2,
  Pencil,
  RefreshCw,
  X,
  Save,
  ChevronDown,
} from "lucide-react";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import toast from "react-hot-toast";

type UserDoc = {
  docId: string;  // always the Firestore document ID — used as React key
  uid?: string;
  // Nomi reali dei campi nei doc "users" (schema FlutterFlow, snake_case)
  display_name?: string;
  email?: string;
  Ruolo?: string;
  Rappresentante?: string;
  last_active_time?: Timestamp;
  Blocco?: boolean;
  Cliente_Ref?: DocumentReference;  // riferimento al doc Clienti (dove vive il fido reale)
  Fido?: number;        // eventuale fido denormalizzato su users (fallback)
  Fido_Residuo?: number;
  // Alias legacy mantenuti come fallback (alcuni doc storici potrebbero usarli)
  Nome?: string;
  Cognome?: string;
  displayName?: string;
  Email?: string;
  lastLogin?: Timestamp;
  Bloccato?: boolean;
};

function formatEuro(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function relativeTime(ts?: Timestamp): string {
  if (!ts) return "—";
  const ms = Date.now() - ts.toMillis();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return "poco fa";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min fa`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ore fa`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} giorni fa`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "mese" : "mesi"} fa`;
  const years = Math.floor(months / 12);
  return `circa ${years === 1 ? "un anno" : `${years} anni`} fa`;
}

const RUOLI_FILTER = [
  "Tutti",
  "Gommista",
  "Grossista",
  "Privato",
  "T24",
  "Rappresentante",
  "Admin",
  "Magazziniere",
  "Impiegato",
];

function getNome(u: UserDoc): string {
  // Campo reale: display_name. Fallback su eventuali alias legacy.
  if (u.display_name && u.display_name.trim()) return u.display_name.trim();
  if (u.Nome && u.Cognome) return `${u.Nome} ${u.Cognome}`;
  if (u.Nome) return u.Nome;
  if (u.displayName && u.displayName.trim()) return u.displayName.trim();
  return "Non disponibile";
}

// Stato di blocco — campo reale "Blocco", con fallback legacy "Bloccato"
function isBloccato(u: UserDoc): boolean {
  return (u.Blocco ?? u.Bloccato) ?? false;
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: 8 }).map((__, j) => (
            <td key={j} className="py-3.5 pr-4">
              <div
                className="h-4 rounded animate-pulse"
                style={{
                  background: "var(--border)",
                  width: j === 7 ? "40px" : j === 6 ? "32px" : "75%",
                }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

type EditState = {
  docId: string;
  Ruolo: string;
  Fido: string;
  Rappresentante: string;
  Bloccato: boolean;
  clienteRef: DocumentReference | null;  // dove scrivere il fido (Clienti se collegato)
};

export default function ClientiPage() {
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtroRuolo, setFiltroRuolo] = useState("Tutti");
  const [aggiornandoFido, setAggiornandoFido] = useState(false);
  const [editUser, setEditUser] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  // Dettagli cliente espandibili (solo mobile) — set dei docId aperti
  const [expandedClienti, setExpandedClienti] = useState<Set<string>>(new Set());
  function toggleClienteDetails(id: string) {
    setExpandedClienti((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Fido risolto dai doc Clienti collegati via Cliente_Ref — mappa path-Clienti → fido
  const [clientiFido, setClientiFido] = useState<Record<string, { fido: number; fidoResiduo: number }>>({});

  // Fido effettivo di un utente: dal Clienti collegato se disponibile, altrimenti fallback su users.Fido
  function fidoForUser(u: UserDoc): number {
    const ref = u.Cliente_Ref;
    if (ref && typeof ref === "object" && "path" in ref) {
      const entry = clientiFido[ref.path];
      if (entry) return entry.fido;
    }
    return u.Fido ?? 0;
  }

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "users"), orderBy("email")),
      (snap) => {
        const seen = new Set<string>();
        const deduped: UserDoc[] = [];
        for (const d of snap.docs) {
          if (!seen.has(d.id)) {
            seen.add(d.id);
            deduped.push({ ...d.data(), docId: d.id } as UserDoc);
          }
        }
        setUsers(deduped);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        toast.error("Errore nel caricamento degli utenti");
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // Risolve i doc Clienti referenziati (Cliente_Ref) per recuperare il fido reale
  useEffect(() => {
    const refs = new Map<string, DocumentReference>();
    for (const u of users) {
      const r = u.Cliente_Ref;
      if (r && typeof r === "object" && "path" in r) refs.set(r.path, r);
    }
    const toFetch = [...refs.values()].filter((r) => !(r.path in clientiFido));
    if (toFetch.length === 0) return;
    let cancelled = false;
    Promise.all(
      toFetch.map(async (r) => {
        try {
          const snap = await getDoc(r);
          if (!snap.exists()) return null;
          const d = snap.data() as { Fido?: number; Fido_Residuo?: number };
          return { path: r.path, fido: Number(d.Fido ?? 0), fidoResiduo: Number(d.Fido_Residuo ?? 0) };
        } catch { return null; }
      })
    ).then((results) => {
      if (cancelled) return;
      setClientiFido((prev) => {
        const next = { ...prev };
        for (const res of results) if (res) next[res.path] = { fido: res.fido, fidoResiduo: res.fidoResiduo };
        return next;
      });
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users]);

  const filtered = useMemo(() => {
    return users.filter((u) => {
      const nome = getNome(u);
      const email = u.Email ?? u.email ?? "";
      const matchSearch =
        !search ||
        [nome, email, u.Ruolo ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
      const matchRuolo = filtroRuolo === "Tutti" || u.Ruolo === filtroRuolo;
      return matchSearch && matchRuolo;
    });
  }, [users, search, filtroRuolo]);

  async function toggleBlocco(u: UserDoc) {
    const id = u.docId ?? u.uid;
    if (!id) return;
    const nuovoStato = !isBloccato(u);
    try {
      await updateDoc(doc(db, "users", id), { Blocco: nuovoStato });
    } catch {
      toast.error("Errore nell'aggiornamento");
    }
  }

  async function aggiornaFido() {
    setAggiornandoFido(true);
    try {
      const res = await fetch(
        "https://europe-west3-crm-3iuocs.cloudfunctions.net/Fido_Management_CSV"
      );
      if (!res.ok) throw new Error(`CF error ${res.status}`);
      toast.success("Fido aggiornato dal CSV");
    } catch {
      toast.error("Errore nell'aggiornamento del fido");
    } finally {
      setAggiornandoFido(false);
    }
  }

  function openEdit(u: UserDoc) {
    const id = u.docId ?? u.uid;
    if (!id) return;
    setEditUser({
      docId: id,
      Ruolo: u.Ruolo ?? "",
      Fido: String(fidoForUser(u)),
      Rappresentante: u.Rappresentante ?? "",
      Bloccato: isBloccato(u),
      clienteRef: u.Cliente_Ref ?? null,
    });
  }

  async function saveEdit() {
    if (!editUser) return;
    setSaving(true);
    const fidoVal = parseFloat(editUser.Fido) || 0;
    try {
      // Ruolo / Rappresentante / Blocco vivono sul doc users
      await updateDoc(doc(db, "users", editUser.docId), {
        Ruolo: editUser.Ruolo,
        Rappresentante: editUser.Rappresentante,
        Blocco: editUser.Bloccato,
      });
      // Il fido vive sul doc Clienti se l'utente è collegato; altrimenti fallback su users
      if (editUser.clienteRef) {
        const ref = editUser.clienteRef;
        await updateDoc(ref, { Fido: fidoVal });
        setClientiFido((prev) => ({
          ...prev,
          [ref.path]: { fido: fidoVal, fidoResiduo: prev[ref.path]?.fidoResiduo ?? 0 },
        }));
      } else {
        await updateDoc(doc(db, "users", editUser.docId), { Fido: fidoVal });
      }
      toast.success("Utente aggiornato");
      setEditUser(null);
    } catch {
      toast.error("Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setSearch("");
    setFiltroRuolo("Tutti");
  }

  const totalCount = users.length;
  const fidoCount  = useMemo(() => users.filter((u) => fidoForUser(u) > 0).length, [users, clientiFido]);
  const gommisti   = useMemo(() => users.filter((u) => u.Ruolo === "Gommista").length, [users]);
  const grossisti  = useMemo(() => users.filter((u) => u.Ruolo === "Grossista").length, [users]);

  const stats = [
    { label: "Totale utenti", value: totalCount, sub: "registrati",    icon: <Users size={22} />,      accent: "#FFC803" },
    { label: "Con fido",      value: fidoCount,  sub: "credito attivo", icon: <CreditCard size={22} />, accent: "#6366F1" },
    { label: "Gommisti",      value: gommisti,   sub: "ruolo B2B",      icon: <Building2 size={22} />,  accent: "#249689" },
    { label: "Grossisti",     value: grossisti,  sub: "ruolo B2B",      icon: <Building2 size={22} />,  accent: "#EE8B60" },
  ];

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1
            className="text-xl md:text-2xl font-bold"
            style={{ fontFamily: "var(--font-poppins)" }}
          >
            Clienti
          </h1>
          <p
            className="text-sm mt-0.5"
            style={{
              color: "var(--text-secondary)",
              fontFamily: "var(--font-montserrat)",
            }}
          >
            {loading ? "Caricamento…" : `${filtered.length} utenti`}
          </p>
        </div>
        <button
          onClick={aggiornaFido}
          disabled={aggiornandoFido}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-all hover:opacity-80 hover:brightness-[1.04] active:scale-[.98] disabled:active:scale-100"
          style={{
            background: "var(--brand)",
            color: "#111",
            fontFamily: "var(--font-montserrat)",
            boxShadow: "var(--shadow-brand)",
          }}
        >
          <RefreshCw
            size={16}
            className={aggiornandoFido ? "animate-spin" : ""}
          />
          Aggiorna Fido
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 md:gap-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      {/* Table card */}
      <Card padding="sm">
        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap">
          {/* Search */}
          <div className="flex-1 min-w-48 relative">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-muted)" }}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per nome, email, ruolo…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none"
              style={{
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                fontFamily: "var(--font-montserrat)",
                color: "var(--text-primary)",
              }}
            />
          </div>

          {/* Ruolo filter */}
          <select
            value={filtroRuolo}
            onChange={(e) => setFiltroRuolo(e.target.value)}
            className="px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{
              background: filtroRuolo !== "Tutti" ? "#FFC80320" : "var(--bg-primary)",
              border: filtroRuolo !== "Tutti" ? "1px solid #FFC803" : "1px solid var(--border)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-montserrat)",
            }}
          >
            {RUOLI_FILTER.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          {(search || filtroRuolo !== "Tutti") && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium"
              style={{
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                fontFamily: "var(--font-montserrat)",
                color: "var(--text-secondary)",
              }}
            >
              <X size={14} /> Azzera
            </button>
          )}
        </div>

        {/* Table — solo desktop */}
        <div className="overflow-x-auto hidden md:block">
          <table
            className="w-full text-sm"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            <thead>
              <tr
                className="text-left border-b"
                style={{ borderColor: "var(--border)" }}
              >
                {[
                  "Nome",
                  "Email",
                  "Ruolo",
                  "Rappresentante",
                  "Ultimo accesso",
                  "Fido",
                  "Blocco",
                  "Azioni",
                ].map((h) => (
                  <th
                    key={h}
                    className="pb-3 pr-4 text-xs font-semibold uppercase tracking-widest whitespace-nowrap"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
              {loading ? (
                <SkeletonRows />
              ) : (
                <>
                  {filtered.map((u, idx) => {
                    const nome  = getNome(u);
                    const email = u.email ?? u.Email ?? "—";
                    const bloccato = isBloccato(u);
                    return (
                      <tr
                        key={`${u.docId ?? u.uid ?? "u"}-${idx}`}
                        className="hover:bg-[#F9FAFB] transition-colors"
                      >
                        {/* Nome */}
                        <td
                          className="py-3.5 pr-4 font-medium"
                          style={{
                            color:
                              nome === "Non disponibile"
                                ? "var(--text-muted)"
                                : "var(--text-primary)",
                          }}
                        >
                          {nome}
                        </td>

                        {/* Email */}
                        <td
                          className="py-3.5 pr-4"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {email}
                        </td>

                        {/* Ruolo */}
                        <td className="py-3.5 pr-4">
                          {u.Ruolo ? (
                            <span
                              className="px-2 py-0.5 rounded-full text-xs font-semibold"
                              style={{
                                background:
                                  u.Ruolo === "Admin"
                                    ? "#FEE2E2"
                                    : u.Ruolo === "Gommista"
                                    ? "#D1FAE5"
                                    : u.Ruolo === "Grossista"
                                    ? "#DBEAFE"
                                    : "#F3F4F6",
                                color:
                                  u.Ruolo === "Admin"
                                    ? "#991B1B"
                                    : u.Ruolo === "Gommista"
                                    ? "#065F46"
                                    : u.Ruolo === "Grossista"
                                    ? "#1E40AF"
                                    : "var(--text-secondary)",
                              }}
                            >
                              {u.Ruolo}
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-muted)" }}>—</span>
                          )}
                        </td>

                        {/* Rappresentante */}
                        <td
                          className="py-3.5 pr-4"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {u.Rappresentante ?? "—"}
                        </td>

                        {/* Ultimo accesso */}
                        <td
                          className="py-3.5 pr-4 whitespace-nowrap"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {relativeTime(u.last_active_time ?? u.lastLogin)}
                        </td>

                        {/* Fido */}
                        <td
                          className="py-3.5 pr-4 whitespace-nowrap"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {formatEuro(fidoForUser(u))}
                        </td>

                        {/* Blocco */}
                        <td className="py-3.5 pr-4">
                          <input
                            type="checkbox"
                            checked={bloccato}
                            onChange={() => toggleBlocco(u)}
                            className="w-4 h-4 cursor-pointer accent-yellow-400"
                            title={bloccato ? "Sblocca utente" : "Blocca utente"}
                          />
                        </td>

                        {/* Azioni */}
                        <td className="py-3.5">
                          <button
                            onClick={() => openEdit(u)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-[#FFC803] hover:text-[#111]"
                            style={{
                              border: "1px solid var(--border)",
                              color: "var(--text-secondary)",
                              fontFamily: "var(--font-montserrat)",
                            }}
                          >
                            <Pencil size={12} />
                            Modifica
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-12 text-center text-sm"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Nessun utente trovato.
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Lista a card — solo mobile */}
        <div className="md:hidden">
          {loading ? (
            <div className="space-y-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "var(--border)" }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              Nessun utente trovato.
            </p>
          ) : (
            <div className="space-y-2.5">
              {filtered.map((u, idx) => {
                const nome  = getNome(u);
                const email = u.email ?? u.Email ?? "—";
                const bloccato = isBloccato(u);
                const id = u.docId ?? u.uid ?? `u-${idx}`;
                const isOpen = expandedClienti.has(id);
                return (
                  <div
                    key={`${id}-${idx}`}
                    className="rounded-xl p-3"
                    style={{ border: "1px solid var(--border)", background: "#fff" }}
                  >
                    {/* Riga principale */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p
                          className="text-sm font-semibold truncate"
                          style={{
                            color: nome === "Non disponibile" ? "var(--text-muted)" : "var(--text-primary)",
                            fontFamily: "var(--font-poppins)",
                          }}
                        >
                          {nome}
                        </p>
                        <p className="text-xs truncate mt-0.5" style={{ color: "var(--text-secondary)" }}>
                          {email}
                        </p>
                      </div>
                      {u.Ruolo ? (
                        <span
                          className="flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                          style={{
                            background:
                              u.Ruolo === "Admin" ? "#FEE2E2"
                              : u.Ruolo === "Gommista" ? "#D1FAE5"
                              : u.Ruolo === "Grossista" ? "#DBEAFE"
                              : "#F3F4F6",
                            color:
                              u.Ruolo === "Admin" ? "#991B1B"
                              : u.Ruolo === "Gommista" ? "#065F46"
                              : u.Ruolo === "Grossista" ? "#1E40AF"
                              : "var(--text-secondary)",
                          }}
                        >
                          {u.Ruolo}
                        </span>
                      ) : (
                        <span className="flex-shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </div>

                    {/* Riga azioni: Fido + toggle */}
                    <div className="flex items-center justify-between gap-2 mt-2.5">
                      <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                        Fido: {formatEuro(fidoForUser(u))}
                      </span>
                      <button
                        onClick={() => toggleClienteDetails(id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold"
                        style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                      >
                        Dettagli
                        <ChevronDown size={14} className="transition-transform" style={{ transform: isOpen ? "rotate(180deg)" : "none" }} />
                      </button>
                    </div>

                    {/* Tendina dettagli */}
                    {isOpen && (
                      <div className="mt-2.5 pt-2.5 flex flex-col gap-2" style={{ borderTop: "1px dashed var(--border)" }}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Rappresentante</span>
                          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{u.Rappresentante ?? "—"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Ultimo accesso</span>
                          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{relativeTime(u.last_active_time ?? u.lastLogin)}</span>
                        </div>
                        <label className="flex items-center justify-between gap-2 cursor-pointer select-none">
                          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Bloccato</span>
                          <input
                            type="checkbox"
                            checked={bloccato}
                            onChange={() => toggleBlocco(u)}
                            className="w-4 h-4 cursor-pointer accent-yellow-400"
                          />
                        </label>
                        <button
                          onClick={() => openEdit(u)}
                          className="mt-1 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all hover:brightness-[1.04] active:scale-[.98]"
                          style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}
                        >
                          <Pencil size={12} />
                          Modifica
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* ── Modale Modifica Utente ── */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setEditUser(null)}
          />
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold" style={{ color: "#111" }}>
                Modifica utente
              </h2>
              <button
                onClick={() => setEditUser(null)}
                className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X size={18} style={{ color: "#111" }} />
              </button>
            </div>

            {/* Ruolo */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-muted)" }}>
                RUOLO
              </label>
              <select
                value={editUser.Ruolo}
                onChange={(e) => setEditUser({ ...editUser, Ruolo: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ border: "1.5px solid #FFC803", fontFamily: "var(--font-montserrat)" }}
              >
                {RUOLI_FILTER.filter((r) => r !== "Tutti").map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            {/* Fido */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-muted)" }}>
                FIDO (€)
              </label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={editUser.Fido}
                onChange={(e) => setEditUser({ ...editUser, Fido: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ border: "1.5px solid #FFC803", fontFamily: "var(--font-montserrat)" }}
              />
            </div>

            {/* Rappresentante */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-muted)" }}>
                RAPPRESENTANTE
              </label>
              <input
                type="text"
                value={editUser.Rappresentante}
                onChange={(e) => setEditUser({ ...editUser, Rappresentante: e.target.value })}
                placeholder="Nome rappresentante"
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ border: "1.5px solid #FFC803", fontFamily: "var(--font-montserrat)" }}
              />
            </div>

            {/* Bloccato */}
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={editUser.Bloccato}
                onChange={(e) => setEditUser({ ...editUser, Bloccato: e.target.checked })}
                className="w-4 h-4 accent-yellow-400"
              />
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Utente bloccato
              </span>
            </label>

            {/* Salva */}
            <button
              onClick={saveEdit}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-85 disabled:opacity-50 hover:brightness-[1.04] active:scale-[.98] disabled:active:scale-100"
              style={{ background: "#FFC803", color: "#111", boxShadow: "var(--shadow-brand)" }}
            >
              <Save size={16} />
              {saving ? "Salvataggio…" : "Salva modifiche"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
