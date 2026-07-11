"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
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
  UserPlus,
  Eye,
  Mail,
  MapPin,
  Briefcase,
} from "lucide-react";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import InfiniteScrollSentinel from "@/components/ui/InfiniteScrollSentinel";
import toast from "react-hot-toast";
import { useFirestoreInfiniteList } from "@/hooks/useFirestoreInfiniteList";

type UserDoc = {
  docId: string;  // always the Firestore document ID — used as React key
  uid?: string;
  // Nomi reali dei campi nei doc "users" (schema FlutterFlow, snake_case)
  display_name?: string;
  email?: string;
  Ruolo?: string;
  Rappresentante?: string;
  Metodo_di_Pagamento?: string;
  last_active_time?: Timestamp | string;  // doc legacy: alcuni sono stringa ISO invece di Timestamp
  Blocco?: boolean;
  Cliente_Ref?: DocumentReference;  // riferimento al doc Clienti (dove vive il fido reale)
  Fido?: number;        // eventuale fido denormalizzato su users (fallback)
  Fido_Residuo?: number;
  // Alias legacy mantenuti come fallback (alcuni doc storici potrebbero usarli)
  Nome?: string;
  Cognome?: string;
  displayName?: string;
  Email?: string;
  lastLogin?: Timestamp | string;
  Bloccato?: boolean;
};

function formatEuro(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

// Alcuni doc legacy hanno last_active_time/lastLogin scritti come stringa ISO
// invece di un Firestore Timestamp (dato esterno, boundary non affidabile —
// normalizza entrambi i formati invece di assumere .toMillis() esista).
function toMillis(ts: Timestamp | string | undefined | null): number | null {
  if (!ts) return null;
  if (typeof ts === "string") {
    const ms = Date.parse(ts);
    return Number.isNaN(ms) ? null : ms;
  }
  return ts.toMillis();
}

function relativeTime(ts?: Timestamp | string): string {
  const start = toMillis(ts);
  if (start === null) return "—";
  const ms = Date.now() - start;
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
  // ── Campi del documento "users" ──
  Ruolo: string;
  Nome: string;               // users.display_name
  Rappresentante: string;     // email del rappresentante assegnato (dropdown)
  MetodoPagamento: string;    // users.Metodo_di_Pagamento
  Fido: string;
  Bloccato: boolean;
  clienteRef: DocumentReference | null;  // dove scrivere il fido / dati anagrafici (Clienti se collegato)
  // ── Campi del documento "Clienti" collegato (se presente) ──
  hasCliente: boolean;
  clienteLoading: boolean;
  ragioneSociale: string;     // Clienti.Ragione_Sociale
  clienteNome: string;        // Clienti.Nome
  telefono: string;           // Clienti.Telefono
  partitaIva: string;         // Clienti.Partita_Iva
};

// Stato del form "Nuovo Cliente" — crea un documento anagrafica nella collezione
// `Clienti` (schema Flutter). Nessun account di login: come il crea_cliente Flutter.
type NewClienteState = {
  Azienda: boolean;
  Nome: string;
  Ragione_Sociale: string;
  Email: string;
  Telefono: string;
  Partita_Iva: string;
  Codice_Fiscale: string;
  PEC: string;
  Via: string;
  Citta: string;
  CAP: string;
  Paese: string;
  Tipo: string;
  Fido: string;
  Metodo_di_Pagamento: string;
  Password: string;
};

const EMPTY_NEW_CLIENTE: NewClienteState = {
  Azienda: false,
  Nome: "",
  Ragione_Sociale: "",
  Email: "",
  Telefono: "",
  Partita_Iva: "",
  Codice_Fiscale: "",
  PEC: "",
  Via: "",
  Citta: "",
  CAP: "",
  Paese: "Italia",
  Tipo: "",
  Fido: "",
  Metodo_di_Pagamento: "",
  Password: "",
};

// Valori tipici del campo Clienti.Tipo (schema Flutter)
const TIPI_CLIENTE = ["Privato", "Gommista", "Grossista", "Officina"];

// Campo di testo riutilizzabile per il form "Nuovo Cliente" (stile coerente col resto)
function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-muted)" }}>
        {label}
        {required && <span style={{ color: "#EF4444" }}> *</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
        style={{ border: "1.5px solid #FFC803", fontFamily: "var(--font-montserrat)" }}
      />
    </div>
  );
}

// Dati dell'anagrafica Clienti collegata, letti per la scheda di dettaglio (sola lettura)
type ClienteDetail = {
  Nome?: string;
  Ragione_Sociale?: string;
  Email?: string;
  Telefono?: string;
  Via?: string;
  Citta?: string;
  CAP?: string;
  Paese?: string;
  Partita_Iva?: string;
  Codice_Fiscale?: string;
  PEC?: string;
  Tipo?: string;
  Azienda?: boolean;
  B2B?: boolean;
  Locale?: boolean;
  Fido?: number;
  Fido_Residuo?: number;
  Metodo_di_Pagamento?: string;
};

// Riga etichetta/valore per la scheda di dettaglio (sola lettura)
function DetailRow({ label, value }: { label: string; value: string }) {
  const shown = value && value.trim() ? value : "—";
  return (
    <div
      className="flex items-start justify-between gap-3 py-2 border-b last:border-b-0"
      style={{ borderColor: "var(--border)" }}
    >
      <span
        className="text-xs font-semibold uppercase tracking-wider flex-shrink-0 pt-0.5"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </span>
      <span
        className="text-sm text-right font-medium break-words"
        style={{ color: shown === "—" ? "var(--text-muted)" : "var(--text-primary)" }}
      >
        {shown}
      </span>
    </div>
  );
}

export default function ClientiPage() {
  const {
    items: users,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    loadAll,
    reload: reloadUsers,
    mutate: mutateUsers,
    epoch: usersEpoch,
  } = useFirestoreInfiniteList<UserDoc>({
    collectionPath: "users",
    orderByField: "email",
    pageSize: 100,
    mapDoc: useCallback((id, data) => ({ ...data, docId: id }) as UserDoc, []),
  });
  const [search, setSearch] = useState("");
  const [filtroRuolo, setFiltroRuolo] = useState("Tutti");
  const [aggiornandoFido, setAggiornandoFido] = useState(false);
  const [editUser, setEditUser] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [newCliente, setNewCliente] = useState<NewClienteState | null>(null);
  const [creating, setCreating] = useState(false);
  // Nuovo rappresentante — account di login (core.utenti), nessuna anagrafica Clienti.
  const [newRapp, setNewRapp] = useState<{ nome: string; email: string; password: string } | null>(null);
  const [creatingRapp, setCreatingRapp] = useState(false);
  // Scheda di dettaglio (sola lettura)
  const [detailUser, setDetailUser] = useState<UserDoc | null>(null);
  const [detailCliente, setDetailCliente] = useState<ClienteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  // La lista di default è paginata (infinite-scroll); una ricerca attiva deve
  // però vedere TUTTI gli utenti, non solo quelli già caricati — drena la
  // collezione intera quando l'utente digita un filtro testuale.
  useEffect(() => {
    if (search.trim()) loadAll();
  }, [search, loadAll, usersEpoch]);

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

  // Elenco rappresentanti selezionabili — come nel FlutterFlow, gli utenti con
  // ruolo "Rappresentante". Il valore salvato è l'email, l'etichetta il nome.
  const rappresentanti = useMemo(
    () =>
      users
        .filter((u) => u.Ruolo === "Rappresentante")
        .map((u) => ({ email: (u.email ?? u.Email ?? "").trim(), nome: getNome(u) }))
        .filter((r) => r.email)
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    [users]
  );

  async function toggleBlocco(u: UserDoc) {
    const id = u.docId ?? u.uid;
    if (!id) return;
    const nuovoStato = !isBloccato(u);
    try {
      await updateDoc(doc(db, "users", id), { Blocco: nuovoStato });
      mutateUsers((prev) => prev.map((x) => (x.docId === id ? { ...x, Blocco: nuovoStato } : x)));
    } catch {
      toast.error("Errore nell'aggiornamento");
    }
  }

  async function aggiornaFido() {
    setAggiornandoFido(true);
    try {
      const res = await fetch("/api/client-sync/fido", { method: "POST" });
      if (!res.ok) throw new Error(`Errore ${res.status}`);
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
    const ref = u.Cliente_Ref ?? null;
    // Stato iniziale coi campi del doc "users" (già disponibili in memoria).
    setEditUser({
      docId: id,
      Ruolo: u.Ruolo ?? "",
      Nome: getNome(u) === "Non disponibile" ? "" : getNome(u),
      Rappresentante: u.Rappresentante ?? "",
      MetodoPagamento: u.Metodo_di_Pagamento ?? "",
      Fido: String(fidoForUser(u)),
      Bloccato: isBloccato(u),
      clienteRef: ref,
      hasCliente: !!ref,
      clienteLoading: !!ref,
      ragioneSociale: "",
      clienteNome: "",
      telefono: "",
      partitaIva: "",
    });
    // Se collegato a un Cliente, carica i dati anagrafici da modificare.
    if (ref) {
      getDoc(ref)
        .then((snap) => {
          const d = (snap.exists() ? snap.data() : {}) as {
            Ragione_Sociale?: string; Nome?: string; Telefono?: string;
            Partita_Iva?: string; Metodo_di_Pagamento?: string;
          };
          setEditUser((prev) =>
            prev && prev.docId === id
              ? {
                  ...prev,
                  clienteLoading: false,
                  ragioneSociale: d.Ragione_Sociale ?? "",
                  clienteNome: d.Nome ?? "",
                  telefono: d.Telefono ?? "",
                  partitaIva: d.Partita_Iva ?? "",
                  // Metodo di pagamento: preferisci quello su users, altrimenti quello del Cliente
                  MetodoPagamento: prev.MetodoPagamento || (d.Metodo_di_Pagamento ?? ""),
                }
              : prev
          );
        })
        .catch(() => {
          setEditUser((prev) =>
            prev && prev.docId === id ? { ...prev, clienteLoading: false } : prev
          );
        });
    }
  }

  async function saveEdit() {
    if (!editUser) return;
    setSaving(true);
    const fidoVal = parseFloat(editUser.Fido) || 0;
    try {
      // Ruolo / Nome / Rappresentante / Metodo di pagamento / Blocco vivono sul doc users
      await updateDoc(doc(db, "users", editUser.docId), {
        Ruolo: editUser.Ruolo,
        display_name: editUser.Nome.trim(),
        Rappresentante: editUser.Rappresentante,
        Metodo_di_Pagamento: editUser.MetodoPagamento.trim(),
        Blocco: editUser.Bloccato,
      });
      // Il fido e l'anagrafica vivono sul doc Clienti se l'utente è collegato
      if (editUser.clienteRef) {
        const ref = editUser.clienteRef;
        await updateDoc(ref, {
          Fido: fidoVal,
          Ragione_Sociale: editUser.ragioneSociale.trim(),
          Nome: editUser.clienteNome.trim(),
          Telefono: editUser.telefono.trim(),
          Partita_Iva: editUser.partitaIva.trim(),
          Metodo_di_Pagamento: editUser.MetodoPagamento.trim(),
        });
        setClientiFido((prev) => ({
          ...prev,
          [ref.path]: { fido: fidoVal, fidoResiduo: prev[ref.path]?.fidoResiduo ?? 0 },
        }));
      } else {
        // Utente non collegato a un Cliente: fido salvato come fallback su users
        await updateDoc(doc(db, "users", editUser.docId), { Fido: fidoVal });
      }
      mutateUsers((prev) => prev.map((x) => (x.docId === editUser.docId ? {
        ...x,
        Ruolo: editUser.Ruolo,
        display_name: editUser.Nome.trim(),
        Rappresentante: editUser.Rappresentante,
        Metodo_di_Pagamento: editUser.MetodoPagamento.trim(),
        Blocco: editUser.Bloccato,
        ...(editUser.clienteRef ? {} : { Fido: fidoVal }),
      } : x)));
      toast.success("Utente aggiornato");
      setEditUser(null);
    } catch {
      toast.error("Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  }

  // Apre la scheda di dettaglio (sola lettura): mostra i dati account e, se collegata,
  // l'anagrafica Clienti (caricata al volo via Cliente_Ref).
  function openDetail(u: UserDoc) {
    setDetailUser(u);
    setDetailCliente(null);
    const ref = u.Cliente_Ref;
    if (ref && typeof ref === "object" && "path" in ref) {
      setDetailLoading(true);
      getDoc(ref)
        .then((snap) => setDetailCliente((snap.exists() ? snap.data() : {}) as ClienteDetail))
        .catch(() => setDetailCliente({}))
        .finally(() => setDetailLoading(false));
    } else {
      setDetailLoading(false);
    }
  }

  // Passa dalla scheda di dettaglio alla modale di modifica dello stesso utente
  function editFromDetail(u: UserDoc) {
    setDetailUser(null);
    openEdit(u);
  }

  function openNew() {
    setNewCliente({ ...EMPTY_NEW_CLIENTE });
  }

  function updateNew<K extends keyof NewClienteState>(key: K, value: NewClienteState[K]) {
    setNewCliente((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function saveNewCliente() {
    if (!newCliente) return;
    const nc = newCliente;
    // Obbligatori come nel crea_cliente Flutter: Nome (o Ragione Sociale se azienda), Email, Telefono, CAP.
    const hasNome = nc.Azienda ? (nc.Ragione_Sociale.trim() || nc.Nome.trim()) : nc.Nome.trim();
    if (!hasNome || !nc.Email.trim() || !nc.Telefono.trim() || !nc.CAP.trim()) {
      toast.error("Compila i campi obbligatori: Nome, Email, Telefono, CAP");
      return;
    }
    if (nc.Password.trim() && nc.Password.trim().length < 6) {
      toast.error("La password del cliente deve avere almeno 6 caratteri");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/clienti", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Azienda: nc.Azienda,
          Nome: nc.Nome,
          Ragione_Sociale: nc.Ragione_Sociale,
          Email: nc.Email,
          Telefono: nc.Telefono,
          Partita_Iva: nc.Partita_Iva,
          Codice_Fiscale: nc.Codice_Fiscale,
          PEC: nc.PEC,
          Via: nc.Via,
          Citta: nc.Citta,
          CAP: nc.CAP,
          Paese: nc.Paese,
          Tipo: nc.Tipo,
          Fido: nc.Fido.trim() === "" ? 0 : parseFloat(nc.Fido) || 0,
          Metodo_di_Pagamento: nc.Metodo_di_Pagamento,
          Password: nc.Password.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Errore nella creazione del cliente");
      toast.success("Cliente creato nell'anagrafica");
      // Se è stata impostata una password, il bridge scrive un nuovo doc "users"
      // su Firestore in modo asincrono — un reload subito dopo potrebbe non
      // vederlo ancora, ma è comunque meglio del nulla (best-effort).
      if (nc.Password.trim()) reloadUsers();
      setNewCliente(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore nella creazione del cliente");
    } finally {
      setCreating(false);
    }
  }

  function openNewRapp() {
    setNewRapp({ nome: "", email: "", password: "" });
  }

  async function saveNewRapp() {
    if (!newRapp) return;
    const { nome, email, password } = newRapp;
    if (!nome.trim() || !email.trim()) {
      toast.error("Compila nome ed email");
      return;
    }
    if (password.length < 6) {
      toast.error("La password deve avere almeno 6 caratteri");
      return;
    }
    setCreatingRapp(true);
    try {
      const res = await fetch("/api/admin/rappresentanti", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Nome: nome, Email: email, Password: password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Errore nella creazione del rappresentante");
      toast.success("Rappresentante creato");
      // Bridge asincrono verso Firestore — best-effort, vedi saveNewCliente sopra.
      reloadUsers();
      setNewRapp(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore nella creazione del rappresentante");
    } finally {
      setCreatingRapp(false);
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
            {loading ? "Caricamento…" : `${filtered.length}${hasMore ? "+" : ""} utenti`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={openNew}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:brightness-110 active:scale-[.98]"
            style={{
              background: "#111",
              color: "#fff",
              fontFamily: "var(--font-montserrat)",
            }}
          >
            <UserPlus size={16} />
            Nuovo Cliente
          </button>
          <button
            onClick={openNewRapp}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:brightness-110 active:scale-[.98]"
            style={{
              background: "#fff",
              color: "#111",
              border: "1.5px solid #111",
              fontFamily: "var(--font-montserrat)",
            }}
          >
            <Briefcase size={16} />
            Nuovo Rappresentante
          </button>
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
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => openDetail(u)}
                              title="Visualizza dettagli"
                              aria-label="Visualizza dettagli"
                              className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-[#FFC803] hover:text-[#111]"
                              style={{
                                border: "1px solid var(--border)",
                                color: "var(--text-secondary)",
                              }}
                            >
                              <Eye size={15} />
                            </button>
                            <button
                              onClick={() => openEdit(u)}
                              title="Modifica"
                              aria-label="Modifica"
                              className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-[#FFC803] hover:text-[#111]"
                              style={{
                                border: "1px solid var(--border)",
                                color: "var(--text-secondary)",
                              }}
                            >
                              <Pencil size={15} />
                            </button>
                          </div>
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
          {!loading && (
            <InfiniteScrollSentinel onVisible={loadMore} hasMore={hasMore} loading={loadingMore} />
          )}
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
                          onClick={() => openDetail(u)}
                          className="mt-1 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all active:scale-[.98]"
                          style={{ background: "#111", color: "#fff", fontFamily: "var(--font-montserrat)" }}
                        >
                          <Eye size={12} />
                          Scheda completa
                        </button>
                        <button
                          onClick={() => openEdit(u)}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all hover:brightness-[1.04] active:scale-[.98]"
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
          {!loading && (
            <InfiniteScrollSentinel onVisible={loadMore} hasMore={hasMore} loading={loadingMore} />
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
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pencil size={18} style={{ color: "#FFC803" }} />
                <h2 className="text-base font-bold" style={{ color: "#111" }}>
                  Modifica utente
                </h2>
              </div>
              <button
                onClick={() => setEditUser(null)}
                className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X size={18} style={{ color: "#111" }} />
              </button>
            </div>

            {/* ── Sezione account (doc users) ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

              {/* Nome (display_name) */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-muted)" }}>
                  NOME
                </label>
                <input
                  type="text"
                  value={editUser.Nome}
                  onChange={(e) => setEditUser({ ...editUser, Nome: e.target.value })}
                  placeholder="Nome utente"
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ border: "1.5px solid #FFC803", fontFamily: "var(--font-montserrat)" }}
                />
              </div>

              {/* Rappresentante (dropdown) */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-muted)" }}>
                  RAPPRESENTANTE
                </label>
                <select
                  value={editUser.Rappresentante}
                  onChange={(e) => setEditUser({ ...editUser, Rappresentante: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ border: "1.5px solid #FFC803", fontFamily: "var(--font-montserrat)" }}
                >
                  <option value="">— Nessuno —</option>
                  {/* Valore attuale non presente tra i rappresentanti noti: mantienilo */}
                  {editUser.Rappresentante &&
                    !rappresentanti.some((r) => r.email === editUser.Rappresentante) && (
                      <option value={editUser.Rappresentante}>{editUser.Rappresentante}</option>
                    )}
                  {rappresentanti.map((r) => (
                    <option key={r.email} value={r.email}>
                      {r.nome} ({r.email})
                    </option>
                  ))}
                </select>
              </div>

              {/* Metodo di Pagamento */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-muted)" }}>
                  METODO DI PAGAMENTO
                </label>
                <input
                  type="text"
                  value={editUser.MetodoPagamento}
                  onChange={(e) => setEditUser({ ...editUser, MetodoPagamento: e.target.value })}
                  placeholder="Es. Bonifico, Contanti…"
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ border: "1.5px solid #FFC803", fontFamily: "var(--font-montserrat)" }}
                />
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

              {/* Bloccato */}
              <label className="flex items-center gap-3 cursor-pointer select-none sm:self-end sm:pb-2.5">
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
            </div>

            {/* ── Sezione anagrafica Cliente (doc Clienti collegato) ── */}
            {editUser.hasCliente && (
              <div className="pt-4 border-t" style={{ borderColor: "var(--border)" }}>
                <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-muted)" }}>
                  Dati cliente
                </p>
                {editUser.clienteLoading ? (
                  <div className="flex items-center gap-2 text-sm py-3" style={{ color: "var(--text-muted)" }}>
                    <RefreshCw size={14} className="animate-spin" />
                    Caricamento dati cliente…
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Ragione Sociale */}
                    <div>
                      <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-muted)" }}>
                        RAGIONE SOCIALE
                      </label>
                      <input
                        type="text"
                        value={editUser.ragioneSociale}
                        onChange={(e) => setEditUser({ ...editUser, ragioneSociale: e.target.value })}
                        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                        style={{ border: "1.5px solid #FFC803", fontFamily: "var(--font-montserrat)" }}
                      />
                    </div>

                    {/* Nome cliente */}
                    <div>
                      <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-muted)" }}>
                        NOME
                      </label>
                      <input
                        type="text"
                        value={editUser.clienteNome}
                        onChange={(e) => setEditUser({ ...editUser, clienteNome: e.target.value })}
                        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                        style={{ border: "1.5px solid #FFC803", fontFamily: "var(--font-montserrat)" }}
                      />
                    </div>

                    {/* Telefono */}
                    <div>
                      <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-muted)" }}>
                        TELEFONO
                      </label>
                      <input
                        type="tel"
                        value={editUser.telefono}
                        onChange={(e) => setEditUser({ ...editUser, telefono: e.target.value })}
                        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                        style={{ border: "1.5px solid #FFC803", fontFamily: "var(--font-montserrat)" }}
                      />
                    </div>

                    {/* Partita IVA */}
                    <div>
                      <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-muted)" }}>
                        PARTITA IVA
                      </label>
                      <input
                        type="text"
                        value={editUser.partitaIva}
                        onChange={(e) => setEditUser({ ...editUser, partitaIva: e.target.value })}
                        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                        style={{ border: "1.5px solid #FFC803", fontFamily: "var(--font-montserrat)" }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Salva */}
            <button
              onClick={saveEdit}
              disabled={saving || editUser.clienteLoading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-85 disabled:opacity-50 hover:brightness-[1.04] active:scale-[.98] disabled:active:scale-100"
              style={{ background: "#FFC803", color: "#111", boxShadow: "var(--shadow-brand)" }}
            >
              <Save size={16} />
              {saving ? "Salvataggio…" : "Salva modifiche"}
            </button>
          </div>
        </div>
      )}

      {/* ── Modale Nuovo Cliente (crea documento anagrafica in Clienti) ── */}
      {newCliente && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => (creating ? null : setNewCliente(null))}
          />
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus size={18} style={{ color: "#FFC803" }} />
                <h2 className="text-base font-bold" style={{ color: "#111" }}>
                  Nuovo cliente
                </h2>
              </div>
              <button
                onClick={() => setNewCliente(null)}
                disabled={creating}
                className="p-1 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                <X size={18} style={{ color: "#111" }} />
              </button>
            </div>

            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Crea un documento anagrafica nella collezione Clienti. Non genera un account di accesso al portale.
            </p>

            {/* Tipo cliente: Azienda + Tipo */}
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={newCliente.Azienda}
                  onChange={(e) => updateNew("Azienda", e.target.checked)}
                  className="w-4 h-4 accent-yellow-400"
                />
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  È un&apos;azienda
                </span>
              </label>
              <div className="min-w-[180px]">
                <select
                  value={newCliente.Tipo}
                  onChange={(e) => updateNew("Tipo", e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ border: "1.5px solid #FFC803", fontFamily: "var(--font-montserrat)" }}
                >
                  <option value="">— Tipo cliente —</option>
                  {TIPI_CLIENTE.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Anagrafica */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-muted)" }}>
                Anagrafica
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <TextField
                  label="NOME / REFERENTE"
                  value={newCliente.Nome}
                  onChange={(v) => updateNew("Nome", v)}
                  placeholder="Nome e cognome"
                  required={!newCliente.Azienda}
                />
                <TextField
                  label="RAGIONE SOCIALE"
                  value={newCliente.Ragione_Sociale}
                  onChange={(v) => updateNew("Ragione_Sociale", v)}
                  placeholder="Denominazione azienda"
                  required={newCliente.Azienda}
                />
                <TextField
                  label="PARTITA IVA"
                  value={newCliente.Partita_Iva}
                  onChange={(v) => updateNew("Partita_Iva", v)}
                  placeholder="IT01234567890"
                />
                <TextField
                  label="CODICE FISCALE"
                  value={newCliente.Codice_Fiscale}
                  onChange={(v) => updateNew("Codice_Fiscale", v)}
                />
              </div>
            </div>

            {/* Contatti */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-muted)" }}>
                Contatti
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <TextField
                  label="EMAIL"
                  type="email"
                  value={newCliente.Email}
                  onChange={(v) => updateNew("Email", v)}
                  placeholder="cliente@email.it"
                  required
                />
                <TextField
                  label="TELEFONO"
                  type="tel"
                  value={newCliente.Telefono}
                  onChange={(v) => updateNew("Telefono", v)}
                  placeholder="+39 …"
                  required
                />
                <TextField
                  label="PEC"
                  type="email"
                  value={newCliente.PEC}
                  onChange={(v) => updateNew("PEC", v)}
                  placeholder="pec@pec.it"
                />
              </div>
            </div>

            {/* Indirizzo */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-muted)" }}>
                Indirizzo
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <TextField
                  label="VIA"
                  value={newCliente.Via}
                  onChange={(v) => updateNew("Via", v)}
                  placeholder="Via e numero civico"
                />
                <TextField
                  label="CITTÀ"
                  value={newCliente.Citta}
                  onChange={(v) => updateNew("Citta", v)}
                />
                <TextField
                  label="CAP"
                  value={newCliente.CAP}
                  onChange={(v) => updateNew("CAP", v)}
                  required
                />
                <TextField
                  label="PAESE"
                  value={newCliente.Paese}
                  onChange={(v) => updateNew("Paese", v)}
                />
              </div>
            </div>

            {/* Commerciale */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-muted)" }}>
                Commerciale
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <TextField
                  label="FIDO (€)"
                  type="number"
                  value={newCliente.Fido}
                  onChange={(v) => updateNew("Fido", v)}
                  placeholder="0"
                />
                <TextField
                  label="METODO DI PAGAMENTO"
                  value={newCliente.Metodo_di_Pagamento}
                  onChange={(v) => updateNew("Metodo_di_Pagamento", v)}
                  placeholder="Es. Bonifico, Contanti…"
                />
              </div>
            </div>

            {/* Accesso — password opzionale per far loggare il cliente allo storefront */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>
                Accesso (opzionale)
              </p>
              <p className="text-xs mb-3" style={{ color: "#9ca3af" }}>
                Imposta una password per permettere al cliente di accedere con la sua email. Lascia vuoto per non creare un account.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <TextField
                  label="PASSWORD CLIENTE"
                  type="password"
                  value={newCliente.Password}
                  onChange={(v) => updateNew("Password", v)}
                  placeholder="min. 6 caratteri"
                />
              </div>
            </div>

            {/* Salva */}
            <button
              onClick={saveNewCliente}
              disabled={creating}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-85 disabled:opacity-50 hover:brightness-[1.04] active:scale-[.98] disabled:active:scale-100"
              style={{ background: "#FFC803", color: "#111", boxShadow: "var(--shadow-brand)" }}
            >
              <Save size={16} />
              {creating ? "Creazione…" : "Crea cliente"}
            </button>
          </div>
        </div>
      )}

      {/* ── Modale Nuovo Rappresentante (solo account di login, nessuna anagrafica Clienti) ── */}
      {newRapp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => (creatingRapp ? null : setNewRapp(null))}
          />
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Briefcase size={18} style={{ color: "#FFC803" }} />
                <h2 className="text-base font-bold" style={{ color: "#111" }}>
                  Nuovo rappresentante
                </h2>
              </div>
              <button
                onClick={() => setNewRapp(null)}
                disabled={creatingRapp}
                className="p-1 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                <X size={18} style={{ color: "#111" }} />
              </button>
            </div>

            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Crea un account di accesso con ruolo Rappresentante. Una volta creato, sarà
              selezionabile nel campo &ldquo;Rappresentante&rdquo; durante la modifica di un cliente.
            </p>

            <div className="space-y-4">
              <TextField
                label="NOME"
                value={newRapp.nome}
                onChange={(v) => setNewRapp((p) => (p ? { ...p, nome: v } : p))}
                placeholder="Nome e cognome"
                required
              />
              <TextField
                label="EMAIL"
                type="email"
                value={newRapp.email}
                onChange={(v) => setNewRapp((p) => (p ? { ...p, email: v } : p))}
                placeholder="rappresentante@spieziatyres.it"
                required
              />
              <TextField
                label="PASSWORD"
                type="password"
                value={newRapp.password}
                onChange={(v) => setNewRapp((p) => (p ? { ...p, password: v } : p))}
                placeholder="min. 6 caratteri"
                required
              />
            </div>

            {/* Salva */}
            <button
              onClick={saveNewRapp}
              disabled={creatingRapp}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-85 disabled:opacity-50 hover:brightness-[1.04] active:scale-[.98] disabled:active:scale-100"
              style={{ background: "#FFC803", color: "#111", boxShadow: "var(--shadow-brand)" }}
            >
              <Save size={16} />
              {creatingRapp ? "Creazione…" : "Crea rappresentante"}
            </button>
          </div>
        </div>
      )}

      {/* ── Scheda dettaglio cliente (sola lettura) ── */}
      {detailUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setDetailUser(null)}
          />
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-bold" style={{ color: "#111", fontFamily: "var(--font-poppins)" }}>
                    {getNome(detailUser)}
                  </h2>
                  {detailUser.Ruolo && (
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-semibold"
                      style={{
                        background:
                          detailUser.Ruolo === "Admin" ? "#FEE2E2"
                          : detailUser.Ruolo === "Gommista" ? "#D1FAE5"
                          : detailUser.Ruolo === "Grossista" ? "#DBEAFE"
                          : "#F3F4F6",
                        color:
                          detailUser.Ruolo === "Admin" ? "#991B1B"
                          : detailUser.Ruolo === "Gommista" ? "#065F46"
                          : detailUser.Ruolo === "Grossista" ? "#1E40AF"
                          : "var(--text-secondary)",
                      }}
                    >
                      {detailUser.Ruolo}
                    </span>
                  )}
                </div>
                <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  {detailUser.email ?? detailUser.Email ?? "—"}
                </p>
              </div>
              <button
                onClick={() => setDetailUser(null)}
                className="p-1 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
              >
                <X size={18} style={{ color: "#111" }} />
              </button>
            </div>

            {/* Sezione Account (doc users) */}
            <div className="rounded-xl p-4" style={{ border: "1px solid var(--border)", background: "var(--bg-primary)" }}>
              <p className="text-xs font-semibold uppercase tracking-widest mb-1 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                <Mail size={13} /> Account
              </p>
              <DetailRow label="Email" value={detailUser.email ?? detailUser.Email ?? ""} />
              <DetailRow label="Ruolo" value={detailUser.Ruolo ?? ""} />
              <DetailRow label="Rappresentante" value={detailUser.Rappresentante ?? ""} />
              <DetailRow label="Metodo pagamento" value={detailUser.Metodo_di_Pagamento ?? ""} />
              <DetailRow label="Bloccato" value={isBloccato(detailUser) ? "Sì" : "No"} />
              <DetailRow label="Ultimo accesso" value={relativeTime(detailUser.last_active_time ?? detailUser.lastLogin)} />
              <DetailRow label="ID documento" value={detailUser.docId} />
            </div>

            {/* Sezione Anagrafica (doc Clienti collegato) */}
            {detailUser.Cliente_Ref ? (
              <div className="rounded-xl p-4" style={{ border: "1px solid var(--border)" }}>
                <p className="text-xs font-semibold uppercase tracking-widest mb-1 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                  <MapPin size={13} /> Anagrafica cliente
                </p>
                {detailLoading ? (
                  <div className="flex items-center gap-2 text-sm py-3" style={{ color: "var(--text-muted)" }}>
                    <RefreshCw size={14} className="animate-spin" /> Caricamento anagrafica…
                  </div>
                ) : (
                  <>
                    <DetailRow label="Ragione sociale" value={detailCliente?.Ragione_Sociale ?? ""} />
                    <DetailRow label="Nome" value={detailCliente?.Nome ?? ""} />
                    <DetailRow label="Tipo" value={detailCliente?.Tipo ?? ""} />
                    <DetailRow label="Azienda" value={detailCliente?.Azienda ? "Sì" : "No"} />
                    <DetailRow label="Partita IVA" value={detailCliente?.Partita_Iva ?? ""} />
                    <DetailRow label="Codice fiscale" value={detailCliente?.Codice_Fiscale ?? ""} />
                    <DetailRow label="PEC" value={detailCliente?.PEC ?? ""} />
                    <DetailRow label="Telefono" value={detailCliente?.Telefono ?? ""} />
                    <DetailRow
                      label="Indirizzo"
                      value={[detailCliente?.Via, detailCliente?.CAP, detailCliente?.Citta, detailCliente?.Paese]
                        .map((x) => (x ?? "").trim())
                        .filter(Boolean)
                        .join(", ")}
                    />
                    <DetailRow label="Fido" value={formatEuro(detailCliente?.Fido ?? 0)} />
                    <DetailRow label="Fido residuo" value={formatEuro(detailCliente?.Fido_Residuo ?? 0)} />
                    <DetailRow label="Metodo pagamento" value={detailCliente?.Metodo_di_Pagamento ?? ""} />
                  </>
                )}
              </div>
            ) : (
              <div className="rounded-xl p-4" style={{ border: "1px dashed var(--border)" }}>
                <p className="text-sm mb-1" style={{ color: "var(--text-muted)" }}>
                  Nessuna anagrafica Clienti collegata a questo account.
                </p>
                <DetailRow label="Fido" value={formatEuro(fidoForUser(detailUser))} />
              </div>
            )}

            {/* Azioni */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setDetailUser(null)}
                className="flex-1 py-3 rounded-xl font-semibold text-sm transition-colors hover:bg-gray-50"
                style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
              >
                Chiudi
              </button>
              <button
                onClick={() => editFromDetail(detailUser)}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all hover:brightness-[1.04] active:scale-[.98]"
                style={{ background: "#FFC803", color: "#111", boxShadow: "var(--shadow-brand)" }}
              >
                <Pencil size={16} /> Modifica
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
