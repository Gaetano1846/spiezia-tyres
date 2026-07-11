"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, getDoc, getDocs, query, orderBy, limit, startAfter, type QueryDocumentSnapshot, type DocumentReference } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/layout/AuthProvider";
import { useCart } from "@/components/layout/CartProvider";
import { Check, Package, Loader2, ShoppingBag, AlertTriangle, ChevronDown, Search, X, UserCheck } from "lucide-react";
import Card from "@/components/ui/Card";
import Link from "next/link";
import toast from "react-hot-toast";
import type { Cliente } from "@/lib/types";

const steps = ["Dati cliente", "Indirizzo", "Conferma"];

type AddressForm = {
  nome: string;
  via: string;
  cap: string;
  citta: string;
  provincia: string;
  partitaIva: string;
};

const emptyAddress: AddressForm = {
  nome: "", via: "", cap: "", citta: "", provincia: "", partitaIva: "",
};

function formatEuro(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center mb-8">
      {steps.map((label, idx) => {
        const isCompleted = idx < current;
        const isActive = idx === current;
        return (
          <div key={idx} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all"
                style={{
                  background: isCompleted || isActive ? "var(--brand)" : "var(--bg-primary)",
                  color: isCompleted || isActive ? "#111" : "var(--text-muted)",
                  border: isCompleted || isActive ? "none" : "2px solid var(--border)",
                  fontFamily: "var(--font-montserrat)",
                }}
              >
                {isCompleted ? <Check size={16} /> : idx + 1}
              </div>
              <span
                className="text-xs whitespace-nowrap"
                style={{
                  color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                  fontFamily: "var(--font-montserrat)",
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className="h-0.5 w-8 sm:w-16 mx-1 sm:mx-2 mb-5"
                style={{ background: idx < current ? "var(--brand)" : "var(--border)" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function InputField({ label, value, onChange, placeholder, required }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none focus:ring-2 transition-all"
        style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
      />
    </div>
  );
}

function AddressFormSection({ title, data, onChange }: {
  title: string;
  data: AddressForm;
  onChange: (d: AddressForm) => void;
}) {
  function set(key: keyof AddressForm) {
    return (v: string) => onChange({ ...data, [key]: v });
  }
  return (
    <div>
      <h3 className="text-sm font-bold mb-3" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>
        {title}
      </h3>
      <div className="space-y-3">
        <InputField label="Ragione sociale / Nome" value={data.nome} onChange={set("nome")} required />
        <InputField label="Indirizzo" value={data.via} onChange={set("via")} placeholder="Via e numero civico" required />
        <div className="grid grid-cols-2 gap-3">
          <InputField label="CAP" value={data.cap} onChange={set("cap")} required />
          <InputField label="Città" value={data.citta} onChange={set("citta")} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Provincia" value={data.provincia} onChange={set("provincia")} placeholder="es. NA" />
          <InputField label="Partita IVA" value={data.partitaIva} onChange={set("partitaIva")} placeholder="IT..." />
        </div>
      </div>
    </div>
  );
}

// ─── SearchableClienteDropdown ────────────────────────────────────────────────

type ClienteSearchResult = Cliente & { id: string };

function clienteDisplayName(c: ClienteSearchResult): string {
  return c.Ragione_Sociale || c.Nome || c.Email || c.Telefono || c.id;
}

function SearchableClienteDropdown({
  value,
  onChange,
  scopeToOwnClients,
}: {
  value: ClienteSearchResult | null;
  onChange: (c: ClienteSearchResult | null) => void;
  // Rappresentante: cerca solo tra i propri clienti assegnati, non l'intera
  // collezione Clienti (che prima era visibile a chiunque avesse accesso a
  // questa modalità, incluso un Rappresentante — bug corretto qui).
  scopeToOwnClients: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<ClienteSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rappresentante: lista dei propri clienti caricata UNA VOLTA (tipicamente
  // poche decine) — il filtro testuale è poi puramente client-side, nessuna
  // query Firestore paginata necessaria per un set così piccolo.
  const [repClienti, setRepClienti] = useState<ClienteSearchResult[] | null>(null);
  useEffect(() => {
    if (!scopeToOwnClients) return;
    fetch("/api/rappresentante/clienti")
      .then((r) => r.json())
      .then((d: { clienti?: ClienteSearchResult[] }) => setRepClienti(d.clienti ?? []))
      .catch(() => setRepClienti([]));
  }, [scopeToOwnClients]);

  const fetchClienti = useCallback(async (text: string, after: QueryDocumentSnapshot | null = null) => {
    if (scopeToOwnClients) {
      const all = repClienti ?? [];
      const t = text.trim().toLowerCase();
      const docs = t
        ? all.filter((c) =>
            (c.Ragione_Sociale || "").toLowerCase().includes(t) ||
            (c.Nome || "").toLowerCase().includes(t) ||
            (c.Telefono || "").toLowerCase().includes(t) ||
            (c.Email || "").toLowerCase().includes(t)
          )
        : all;
      setResults(docs);
      setHasMore(false);
      setLoading(repClienti === null);
      return;
    }
    setLoading(true);
    try {
      const col = collection(db, "Clienti");
      const PAGE = 10;
      let q;
      if (text.trim() === "") {
        q = after
          ? query(col, orderBy("Ragione_Sociale"), startAfter(after), limit(PAGE))
          : query(col, orderBy("Ragione_Sociale"), limit(PAGE));
      } else {
        // Search client-side among a reasonable subset: fetch up to 200, filter locally
        q = query(col, orderBy("Ragione_Sociale"), limit(200));
      }
      const snap = await getDocs(q);
      let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClienteSearchResult));
      if (text.trim() !== "") {
        const t = text.toLowerCase();
        docs = docs.filter((c) =>
          (c.Ragione_Sociale || "").toLowerCase().includes(t) ||
          (c.Nome || "").toLowerCase().includes(t) ||
          (c.Telefono || "").toLowerCase().includes(t) ||
          (c.Email || "").toLowerCase().includes(t)
        );
      }
      if (after) {
        setResults((prev) => [...prev, ...docs]);
      } else {
        setResults(docs);
      }
      const last = snap.docs[snap.docs.length - 1] ?? null;
      setLastDoc(last);
      setHasMore(snap.docs.length === PAGE && text.trim() === "");
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [scopeToOwnClients, repClienti]);

  // Debounce search
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchClienti(searchText, null);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchText, open, fetchClienti]);

  // Open dropdown and focus input
  function handleOpen() {
    setOpen(true);
    setSearchText("");
    setLastDoc(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function selectCliente(c: ClienteSearchResult) {
    onChange(c);
    setOpen(false);
  }

  function clearCliente(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(null);
  }

  return (
    <div className="relative" ref={containerRef}>
      <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
        Seleziona cliente<span className="text-red-500 ml-0.5">*</span>
      </label>

      {/* Trigger */}
      <button
        type="button"
        onClick={handleOpen}
        className="w-full px-3 py-2.5 rounded-xl text-sm text-left flex items-center gap-2 transition-all"
        style={{
          background: "var(--bg-primary)",
          border: "1px solid var(--border)",
          fontFamily: "var(--font-montserrat)",
          color: value ? "var(--text-primary)" : "var(--text-muted)",
        }}
      >
        <Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span className="flex-1 truncate">
          {value ? clienteDisplayName(value) : "Cerca per nome, ragione sociale o telefono…"}
        </span>
        {value && (
          <span
            onClick={clearCliente}
            className="flex items-center p-0.5 rounded hover:opacity-70 cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={14} />
          </span>
        )}
        {!value && <ChevronDown size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-xl shadow-lg overflow-hidden"
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            maxHeight: "280px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Search input */}
          <div className="p-2 border-b" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "var(--bg-primary)" }}>
              <Search size={13} style={{ color: "var(--text-muted)" }} />
              <input
                ref={inputRef}
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Cerca…"
                className="flex-1 text-sm outline-none bg-transparent"
                style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}
              />
              {searchText && (
                <button onClick={() => setSearchText("")} style={{ color: "var(--text-muted)" }}>
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Results */}
          <div className="overflow-y-auto flex-1">
            {loading && results.length === 0 && (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-muted)" }} />
              </div>
            )}
            {!loading && results.length === 0 && (
              <div className="py-6 text-center text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                Nessun cliente trovato
              </div>
            )}
            {results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectCliente(c)}
                className="w-full text-left px-4 py-3 text-sm hover:opacity-80 transition-opacity border-b last:border-b-0"
                style={{
                  borderColor: "var(--border)",
                  fontFamily: "var(--font-montserrat)",
                  color: "var(--text-primary)",
                  background: value?.id === c.id ? "rgba(255,200,3,0.08)" : "transparent",
                }}
              >
                <div className="font-semibold truncate">{clienteDisplayName(c)}</div>
                <div className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                  {[c.Tipo, c.Telefono, c.Email].filter(Boolean).join(" · ") || c.id}
                </div>
              </button>
            ))}
            {hasMore && (
              <button
                type="button"
                onClick={() => fetchClienti(searchText, lastDoc)}
                disabled={loading}
                className="w-full py-2 text-xs font-semibold"
                style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
              >
                {loading ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Carica altri…"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type SavedAddress = AddressForm & { id: string; label?: string };

export default function CheckoutPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { items, itemsConSconto, totals, totalsConSconto, clear } = useCart();
  const [step, setStep] = useState(0);
  const [fatturazione, setFatturazione] = useState<AddressForm>(emptyAddress);
  const [spedizioneDiv, setSpedizioneDiv] = useState(false);
  const [spedizione, setSpedizione] = useState<AddressForm>(emptyAddress);
  const [submitting, setSubmitting] = useState(false);
  // Guardia sincrona contro il doppio submit: setSubmitting(true) è asincrono,
  // un secondo click prima del re-render creerebbe un ordine duplicato.
  const submittingRef = useRef(false);
  const [fidoBlocked, setFidoBlocked] = useState(false);
  // Errore bloccante dal server (es. limite di credito) — popup fisso con OK,
  // non un toast che sparisce da solo: il cliente deve poterlo rileggere.
  const [blockedError, setBlockedError] = useState<string | null>(null);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);

  // Ordine per conto di un cliente: riservato ad Admin e Rappresentanti — mai ai clienti normali.
  const isAdmin = user?.Ruolo === "Admin";
  const canOrderForClient = isAdmin || user?.Ruolo === "Rappresentante";
  const [ordinaPerCliente, setOrdinaPerCliente] = useState(false);
  const [clienteSelezionato, setClienteSelezionato] = useState<(Cliente & { id: string }) | null>(null);
  // Indirizzi fatturazione del cliente selezionato (admin mode)
  const [clienteAddresses, setClienteAddresses] = useState<SavedAddress[]>([]);

  // Quando admin seleziona un cliente, carica gli indirizzi di fatturazione del cliente
  useEffect(() => {
    if (!clienteSelezionato) {
      setClienteAddresses([]);
      return;
    }
    getDocs(collection(db, "Clienti", clienteSelezionato.id, "Indirizzo_FatturazioneC"))
      .then((snap) => {
        const addrs: SavedAddress[] = snap.docs.map((d) => {
          const a = d.data() as Record<string, string>;
          return {
            id: d.id,
            label: a.Ragione_Sociale ?? a.Azienda ?? a.Nome ?? a.Via ?? "",
            nome: a.Ragione_Sociale ?? a.Azienda ?? a.Nome ?? "",
            via: a.Via ?? "",
            cap: a.CAP ?? "",
            citta: a.Citta ?? "",
            provincia: a.Provincia ?? "",
            partitaIva: a.PartitaIVA ?? a.Partita_IVA ?? "",
          };
        });
        setClienteAddresses(addrs);
        // Pre-popola il form fatturazione con il primo indirizzo del cliente
        if (addrs.length > 0) {
          const first = addrs[0];
          setFatturazione({ nome: first.nome, via: first.via, cap: first.cap, citta: first.citta, provincia: first.provincia, partitaIva: first.partitaIva });
        }
      })
      .catch(() => {});
  }, [clienteSelezionato]);

  useEffect(() => {
    if (!user?.uid) return;
    // Load fido and saved addresses in parallel
    Promise.all([
      getDoc(doc(db, "users", user.uid)),
      getDocs(collection(db, "users", user.uid, "Indirizzo_Fatturazione")),
    ]).then(([userSnap, addrSnap]) => {
      if (userSnap.exists()) {
        const d = userSnap.data() as Record<string, unknown>;
        if (typeof d.Fido_Residuo === "number" && d.Fido_Residuo < 0) {
          setFidoBlocked(true);
        }
      }
      const addrs: SavedAddress[] = addrSnap.docs.map((d) => {
        const a = d.data() as Record<string, string>;
        return {
          id: d.id,
          label: a.Nome ?? a.Azienda ?? a.Ragione_Sociale ?? "",
          nome: a.Nome ?? a.Ragione_Sociale ?? a.Azienda ?? "",
          via: a.Via ?? "",
          cap: a.CAP ?? "",
          citta: a.Citta ?? "",
          provincia: a.Provincia ?? "",
          partitaIva: a.PartitaIVA ?? a.PIVA ?? "",
        };
      });
      setSavedAddresses(addrs);
    }).catch(() => {});
  }, [user?.uid]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <ShoppingBag size={56} style={{ color: "var(--text-muted)" }} />
        <p className="text-lg font-semibold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
          Il carrello è vuoto
        </p>
        <Link
          href="/"
          className="px-6 py-2.5 rounded-full text-sm font-bold"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-poppins)" }}
        >
          Vai al catalogo
        </Link>
      </div>
    );
  }

  if (fidoBlocked) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 flex flex-col items-center gap-5 text-center">
        <AlertTriangle size={52} style={{ color: "#EF4444" }} />
        <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
          Fido esaurito
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
          Il tuo fido residuo è negativo. Non è possibile procedere con il checkout. Contatta il tuo agente commerciale per regolarizzare la situazione.
        </p>
        <Link href="/carrello" className="px-6 py-2.5 rounded-full text-sm font-bold" style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}>
          ← Torna al carrello
        </Link>
      </div>
    );
  }

  // Fido del cliente selezionato (solo "ordina per conto di") — i dati vengono
  // già dal fetch client-side di SearchableClienteDropdown (legge l'intero doc
  // Clienti), nessun fetch aggiuntivo necessario. Solo un avviso/blocco lato
  // UI: il controllo autoritativo resta lato server in /api/checkout/ordine.
  const clienteFidoResiduo =
    canOrderForClient && ordinaPerCliente && clienteSelezionato && typeof clienteSelezionato.Fido === "number"
      ? (typeof clienteSelezionato.Fido_Residuo === "number" ? clienteSelezionato.Fido_Residuo : clienteSelezionato.Fido)
      : null;
  const clienteFidoInsufficiente = clienteFidoResiduo !== null && totalsConSconto.totale > clienteFidoResiduo;

  async function handleConfirm() {
    if (!user?.uid) return;
    if (submittingRef.current) return; // doppio submit: ordine già in corso
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const addr = (data: AddressForm) => ({
        Nome: data.nome,
        Cognome: "",
        Via: data.via,
        Civico: "",
        CAP: data.cap,
        Citta: data.citta,
        Provincia: data.provincia,
        Paese: "IT",
        PartitaIVA: data.partitaIva || undefined,
      });

      // Risolvi sede per il counter sequenziale
      const sedeDocRef = user.Sede;
      let sedeId = "main";
      if (sedeDocRef && typeof sedeDocRef === "object" && "id" in sedeDocRef) {
        sedeId = (sedeDocRef as { id: string }).id;
      } else if (user.SedeNome) {
        sedeId = user.SedeNome;
      }

      // Contatore + scrittura Ordini avvengono SERVER-SIDE (Admin SDK): le
      // Firestore Security Rules richiedono un token Firebase Auth live, che
      // un cliente autenticato via Postgres (auth VPS-native) non ha — la
      // scrittura diretta dal browser fallirebbe sempre con permission-denied.
      const res = await fetch("/api/checkout/ordine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sedeId,
          articoli: itemsConSconto.map((i) => ({
            id: i.id, marca: i.marca, modello: i.modello, quantita: i.quantita,
            prezzoScontato: i.prezzoScontato, pfu: i.pfu, sconto: i.sconto,
          })),
          totale: totalsConSconto.totale,
          iva: totalsConSconto.iva,
          pfu: totalsConSconto.pfu,
          scontoTotale: totalsConSconto.scontoTotale,
          contributoLogistico: totalsConSconto.contributoLogistico,
          fatturazione,
          spedizione: spedizioneDiv ? spedizione : fatturazione,
          clienteId: canOrderForClient && ordinaPerCliente && clienteSelezionato ? clienteSelezionato.id : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; numero?: string; error?: string; code?: string };
      if (!res.ok || !data.id) {
        if (data.code === "ORDER_BLOCKED") {
          setBlockedError(data.error ?? "Non è possibile completare l'ordine in questo momento. Contattaci per assistenza.");
          submittingRef.current = false;
          setSubmitting(false);
          return;
        }
        throw new Error(data.error ?? "Errore nella creazione dell'ordine");
      }

      // ── Email conferma ordine (fire-and-forget) ──────────────────────────────
      const emailAddr = spedizioneDiv ? addr(spedizione) : addr(fatturazione);
      fetch("https://europe-west3-crm-3iuocs.cloudfunctions.net/Order_Email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: fatturazione.nome || user.displayName || user.email || "",
          order_number:  data.numero,
          order_total:   totalsConSconto.totale,
          order_date:    new Date().toLocaleDateString("it-IT"),
          fatturazioneJson: JSON.stringify(addr(fatturazione)),
          spedizioneJson:   JSON.stringify(emailAddr),
          productsJson:     JSON.stringify(
            itemsConSconto.map((i) => ({
              titolo: `${i.marca} ${i.modello}`,
              misura: i.misura,
              stagione: i.stagione,
              quantita: i.quantita,
              prezzoUnitario: i.prezzoScontato,
              pfu: i.pfu,
            }))
          ),
          emailsList: [user.email].filter(Boolean),
        }),
      }).catch(() => {});


      clear();
      toast.success("Ordine confermato!");
      router.replace(`/ordini/${data.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore nella creazione dell'ordine");
      console.error(e);
      submittingRef.current = false; // errore: consenti un nuovo tentativo
    } finally {
      setSubmitting(false);
    }
  }

  function OrderSummary() {
    return (
      <Card>
        <h3 className="text-base font-bold mb-4" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>
          Riepilogo ordine
        </h3>
        {/* Admin/Rappresentante: cliente selezionato badge */}
        {canOrderForClient && ordinaPerCliente && clienteSelezionato && (
          <div
            className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg"
            style={{ background: "rgba(255,200,3,0.10)", border: "1px solid rgba(255,200,3,0.3)" }}
          >
            <UserCheck size={14} style={{ color: "#FFC803", flexShrink: 0 }} />
            <span className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
              Per: {clienteDisplayName(clienteSelezionato)}
            </span>
          </div>
        )}
        <div className="space-y-3 mb-4">
          {itemsConSconto.map((item) => (
            <div key={item.id} className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
                {item.immagine ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.immagine} alt={item.modello} className="w-full h-full object-contain" />
                ) : (
                  <Package size={18} style={{ color: "var(--text-muted)" }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>
                  {item.marca} {item.modello}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  {item.misura} · {item.stagione}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs font-bold" style={{ color: item.sconto ? "#16a34a" : "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                  {formatEuro(item.prezzoScontato * item.quantita)}
                </p>
                <p className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  ×{item.quantita}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t pt-3 space-y-2" style={{ borderColor: "var(--border)" }}>
          <div className="flex justify-between text-xs" style={{ fontFamily: "var(--font-montserrat)" }}>
            <span style={{ color: "var(--text-secondary)" }}>Subtotale</span>
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{formatEuro(totalsConSconto.subtotale)}</span>
          </div>
          {totalsConSconto.scontoTotale > 0 && (
            <div className="flex justify-between text-xs" style={{ fontFamily: "var(--font-montserrat)" }}>
              <span style={{ color: "#16a34a", fontWeight: 600 }}>Sconto promo</span>
              <span style={{ color: "#16a34a", fontWeight: 700 }}>- {formatEuro(totalsConSconto.scontoTotale)}</span>
            </div>
          )}
          <div className="flex justify-between text-xs" style={{ fontFamily: "var(--font-montserrat)" }}>
            <span style={{ color: "var(--text-secondary)" }}>PFU</span>
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{formatEuro(totalsConSconto.pfu)}</span>
          </div>
          <div className="flex justify-between text-xs" style={{ fontFamily: "var(--font-montserrat)" }}>
            <span style={{ color: "var(--text-secondary)" }}>Contrib. logistico</span>
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{formatEuro(totalsConSconto.contributoLogistico)}</span>
          </div>
          <div className="flex justify-between text-xs" style={{ fontFamily: "var(--font-montserrat)" }}>
            <span style={{ color: "var(--text-secondary)" }}>IVA (22%)</span>
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{formatEuro(totalsConSconto.iva)}</span>
          </div>
          <div className="flex justify-between pt-2 border-t" style={{ borderColor: "var(--border)" }}>
            <span className="font-bold text-sm" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>Totale</span>
            <span className="font-bold text-sm" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>{formatEuro(totalsConSconto.totale)}</span>
          </div>
        </div>
      </Card>
    );
  }

  function StepContent() {
    if (step === 0) {
      return (
        <Card>
          <h2 className="text-lg font-bold mb-5" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>
            Dati cliente
          </h2>
          <div className="space-y-4">
            {/* Logged-in user info */}
            <div className="p-4 rounded-xl" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
              <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                Utente
              </p>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>
                {user?.email}
              </p>
              {user?.Ruolo && (
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  {user.Ruolo}
                </p>
              )}
            </div>

            {/* Admin/Rappresentante: ordine per conto di un cliente — mai per clienti normali */}
            {canOrderForClient && (
              <div className="rounded-xl" style={{ border: "2px solid #FFC803", background: "rgba(255,200,3,0.04)" }}>
                {/* Toggle row */}
                <label
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
                  style={{ fontFamily: "var(--font-montserrat)" }}
                >
                  <input
                    type="checkbox"
                    checked={ordinaPerCliente}
                    onChange={(e) => {
                      setOrdinaPerCliente(e.target.checked);
                      if (!e.target.checked) setClienteSelezionato(null);
                    }}
                    className="w-4 h-4 accent-yellow-400 cursor-pointer flex-shrink-0"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                      Ordine per conto di un cliente
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Solo amministratori e rappresentanti
                    </p>
                  </div>
                  {ordinaPerCliente && clienteSelezionato && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: "rgba(255,200,3,0.25)" }}>
                      <UserCheck size={12} style={{ color: "#92660a" }} />
                      <span className="text-xs font-bold max-w-[120px] truncate" style={{ color: "#92660a" }}>
                        {clienteDisplayName(clienteSelezionato)}
                      </span>
                    </div>
                  )}
                </label>

                {/* Expanded: cliente search */}
                {ordinaPerCliente && (
                  <div className="px-4 pb-4" style={{ borderTop: "1px solid rgba(255,200,3,0.3)" }}>
                    <div className="pt-3">
                      <SearchableClienteDropdown
                        value={clienteSelezionato}
                        onChange={setClienteSelezionato}
                        scopeToOwnClients={!isAdmin}
                      />
                    </div>
                    {clienteSelezionato && (
                      <div
                        className="mt-3 p-3 rounded-xl flex items-center gap-3"
                        style={{ background: "rgba(255,200,3,0.1)", border: "1px solid rgba(255,200,3,0.35)" }}
                      >
                        <UserCheck size={16} style={{ color: "#FFC803", flexShrink: 0 }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>
                            {clienteDisplayName(clienteSelezionato)}
                          </p>
                          {clienteSelezionato.Telefono && (
                            <p className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                              {clienteSelezionato.Telefono}
                            </p>
                          )}
                        </div>
                        {clienteFidoResiduo !== null && (
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                              Fido residuo
                            </p>
                            <p
                              className="text-sm font-bold"
                              style={{ color: clienteFidoInsufficiente ? "#EF4444" : "#16a34a", fontFamily: "var(--font-poppins)" }}
                            >
                              {formatEuro(clienteFidoResiduo)}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    {clienteFidoInsufficiente && (
                      <div
                        className="mt-2 p-3 rounded-xl flex items-start gap-2"
                        style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}
                      >
                        <AlertTriangle size={15} style={{ color: "#EF4444", flexShrink: 0, marginTop: 1 }} />
                        <p className="text-xs" style={{ color: "#991B1B", fontFamily: "var(--font-montserrat)" }}>
                          Fido insufficiente per coprire il totale dell&apos;ordine. Contatta l&apos;amministrazione.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      );
    }

    if (step === 1) {
      return (
        <Card>
          <h2 className="text-lg font-bold mb-5" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>
            Indirizzo
          </h2>
          <div className="space-y-5">
            {/* Admin/Rappresentante mode: indirizzi fatturazione del cliente selezionato */}
            {canOrderForClient && ordinaPerCliente && clienteAddresses.length > 0 && (
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                  Indirizzo fatturazione del cliente
                </label>
                <div className="relative">
                  <select
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none appearance-none pr-8"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
                    defaultValue={clienteAddresses[0]?.id ?? ""}
                    onChange={(e) => {
                      const addr = clienteAddresses.find((a) => a.id === e.target.value);
                      if (addr) setFatturazione({ nome: addr.nome, via: addr.via, cap: addr.cap, citta: addr.citta, provincia: addr.provincia, partitaIva: addr.partitaIva });
                    }}
                  >
                    {clienteAddresses.map((a) => (
                      <option key={a.id} value={a.id}>{a.label || a.nome || a.via}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
                </div>
              </div>
            )}
            {/* Indirizzi utente salvati (modalità normale) */}
            {(!canOrderForClient || !ordinaPerCliente) && savedAddresses.length > 0 && (
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                  Usa un indirizzo salvato
                </label>
                <div className="relative">
                  <select
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none appearance-none pr-8"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
                    defaultValue=""
                    onChange={(e) => {
                      const addr = savedAddresses.find((a) => a.id === e.target.value);
                      if (addr) setFatturazione({ nome: addr.nome, via: addr.via, cap: addr.cap, citta: addr.citta, provincia: addr.provincia, partitaIva: addr.partitaIva });
                    }}
                  >
                    <option value="" disabled>— Seleziona —</option>
                    {savedAddresses.map((a) => (
                      <option key={a.id} value={a.id}>{a.label || a.nome || a.via}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
                </div>
              </div>
            )}
            <AddressFormSection title="Indirizzo di fatturazione" data={fatturazione} onChange={setFatturazione} />
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="spedDiv"
                checked={spedizioneDiv}
                onChange={(e) => setSpedizioneDiv(e.target.checked)}
                className="w-4 h-4 accent-yellow-400"
              />
              <label htmlFor="spedDiv" className="text-sm cursor-pointer" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                Indirizzo di spedizione diverso
              </label>
            </div>
            {spedizioneDiv && (
              <AddressFormSection title="Indirizzo di spedizione" data={spedizione} onChange={setSpedizione} />
            )}
          </div>
        </Card>
      );
    }

    if (step === 2) {
      return (
        <Card>
          <h2 className="text-lg font-bold mb-5" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>
            Conferma ordine
          </h2>
          <div className="space-y-5">
            {/* Admin/Rappresentante: riepilogo cliente selezionato */}
            {canOrderForClient && ordinaPerCliente && clienteSelezionato && (
              <div>
                <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  Ordine per cliente
                </p>
                <div
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                  style={{ background: "rgba(255,200,3,0.08)", border: "1px solid rgba(255,200,3,0.25)" }}
                >
                  <UserCheck size={15} style={{ color: "#FFC803" }} />
                  <span className="text-sm font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                    {clienteDisplayName(clienteSelezionato)}
                  </span>
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                Indirizzo fatturazione
              </p>
              {fatturazione.nome ? (
                <p className="text-sm" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                  {fatturazione.nome}, {fatturazione.via}, {fatturazione.cap} {fatturazione.citta} ({fatturazione.provincia})
                </p>
              ) : (
                <p className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>Non compilato</p>
              )}
            </div>
            {spedizioneDiv && (
              <div>
                <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  Indirizzo spedizione
                </p>
                {spedizione.nome ? (
                  <p className="text-sm" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                    {spedizione.nome}, {spedizione.via}, {spedizione.cap} {spedizione.citta} ({spedizione.provincia})
                  </p>
                ) : (
                  <p className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>Non compilato</p>
                )}
              </div>
            )}
            <div>
              <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                Articoli ({items.length})
              </p>
              <div className="space-y-2">
                {itemsConSconto.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                      {item.marca} {item.modello} × {item.quantita}
                    </span>
                    <span style={{ color: item.sconto ? "#16a34a" : "var(--text-primary)", fontFamily: "var(--font-montserrat)", fontWeight: 600 }}>
                      {formatEuro(item.prezzoScontato * item.quantita)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div
              className="p-4 rounded-xl flex items-center justify-between"
              style={{ background: "rgba(255,200,3,0.08)", border: "1px solid rgba(255,200,3,0.3)" }}
            >
              <span className="font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>
                Totale ordine
              </span>
              <span className="font-bold text-lg" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>
                {formatEuro(totalsConSconto.totale)}
              </span>
            </div>
          </div>
        </Card>
      );
    }

    return null;
  }

  // Navigation: step 0 advance requires cliente selected if admin mode is active
  function handleNext() {
    if (step === 0 && canOrderForClient && ordinaPerCliente && !clienteSelezionato) {
      toast.error("Seleziona un cliente prima di procedere");
      return;
    }
    if (step === 0 && clienteFidoInsufficiente) {
      toast.error("Fido insufficiente per coprire il totale dell'ordine. Contatta l'amministrazione.");
      return;
    }
    if (step === 1) {
      const f = fatturazione;
      if (!f.nome.trim() || !f.via.trim() || !f.citta.trim() || !f.cap.trim()) {
        toast.error("Compila i campi obbligatori dell'indirizzo di fatturazione");
        return;
      }
      if (spedizioneDiv) {
        const s = spedizione;
        if (!s.nome.trim() || !s.via.trim() || !s.citta.trim() || !s.cap.trim()) {
          toast.error("Compila i campi obbligatori dell'indirizzo di spedizione");
          return;
        }
      }
    }
    setStep((s) => s + 1);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>
        Checkout
      </h1>

      <StepIndicator current={step} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-4">
          {/* Invocate come funzioni (non come <StepContent/>) per non rimontare il sottoalbero
              ad ogni keystroke: altrimenti gli input perdono il focus dopo un carattere. */}
          {StepContent()}

          <div className="flex items-center justify-between gap-4">
            {step > 0 ? (
              <button
                onClick={() => setStep((s) => s - 1)}
                disabled={submitting}
                className="px-6 py-2.5 rounded-full text-sm font-semibold transition-all hover:bg-white active:scale-[.98]"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
              >
                Indietro
              </button>
            ) : (
              <div />
            )}
            {step < 2 ? (
              <button
                onClick={handleNext}
                className="px-6 py-2.5 rounded-full text-sm font-semibold transition-all hover:brightness-[1.04] active:scale-[.98]"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}
              >
                Avanti
              </button>
            ) : (
              <button
                onClick={handleConfirm}
                disabled={submitting || clienteFidoInsufficiente}
                className="flex items-center gap-2 px-8 py-2.5 rounded-full text-sm font-semibold transition-all hover:brightness-[1.04] active:scale-[.98] disabled:opacity-60 disabled:active:scale-100"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                Conferma ordine
              </button>
            )}
          </div>
        </div>

        <div className="lg:col-span-1 sticky top-6">
          {OrderSummary()}
        </div>
      </div>

      {/* ── Popup errore bloccante — fisso al centro, si chiude solo con OK ── */}
      {blockedError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4"
            style={{ fontFamily: "var(--font-montserrat)" }}
          >
            <AlertTriangle size={40} style={{ color: "#EF4444" }} className="mx-auto" />
            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {blockedError}
            </p>
            <button
              onClick={() => setBlockedError(null)}
              className="w-full py-2.5 rounded-xl font-bold text-sm transition-all hover:brightness-[1.04] active:scale-[.98]"
              style={{ background: "var(--brand)", color: "#111" }}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
