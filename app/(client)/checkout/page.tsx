"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { collection, addDoc, serverTimestamp, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/layout/AuthProvider";
import { useCart } from "@/components/layout/CartProvider";
import { Check, Package, Loader2, ShoppingBag, AlertTriangle, ChevronDown } from "lucide-react";
import Card from "@/components/ui/Card";
import Link from "next/link";
import toast from "react-hot-toast";

const metodiPagamento = [
  { id: "bonifico",  label: "Bonifico bancario" },
  { id: "contanti",  label: "Contanti alla consegna" },
  { id: "carta",     label: "Carta di credito" },
  { id: "fido",      label: "Fido" },
];

const steps = ["Dati cliente", "Indirizzo", "Pagamento", "Conferma"];

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

function generateNumero(): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${year}-${rand}`;
}

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
                className="h-0.5 w-16 mx-2 mb-5"
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
          <InputField label="Provincia" value={data.provincia} onChange={set("provincia")} placeholder="es. NA" required />
          <InputField label="Partita IVA" value={data.partitaIva} onChange={set("partitaIva")} placeholder="IT..." />
        </div>
      </div>
    </div>
  );
}

type SavedAddress = AddressForm & { id: string; label?: string };

export default function CheckoutPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { items, totals, clear } = useCart();
  const [step, setStep] = useState(0);
  const [fatturazione, setFatturazione] = useState<AddressForm>(emptyAddress);
  const [spedizioneDiv, setSpedizioneDiv] = useState(false);
  const [spedizione, setSpedizione] = useState<AddressForm>(emptyAddress);
  const [metodo, setMetodo] = useState("bonifico");
  const [submitting, setSubmitting] = useState(false);
  const [fidoBlocked, setFidoBlocked] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);

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

  async function handleConfirm() {
    if (!user?.uid) return;
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

      await addDoc(collection(db, "Ordini"), {
        Utente: doc(db, "users", user.uid),
        Source: "B2B",
        Stato: "In attesa di pagamento",
        Numero: generateNumero(),
        Articoli: items.map((i) => ({
          Prodotto: i.id,
          Titolo: `${i.marca} ${i.modello}`,
          Marca: i.marca,
          Quantita: i.quantita,
          PrezzoUnitario: i.prezzo,
          PFU: i.pfu,
        })),
        Totale: totals.totale,
        IVA: totals.iva,
        PFU: totals.pfu,
        Pagamento: {
          Metodo: metodo,
          Stato: "In attesa",
        },
        ContributoLogistico: totals.contributoLogistico,
        IndirizzoFatturazione: addr(fatturazione),
        IndirizzoSpedizione: spedizioneDiv ? addr(spedizione) : addr(fatturazione),
        DataCreazione: serverTimestamp(),
      });

      clear();
      toast.success("Ordine confermato!");
      router.replace("/ordini");
    } catch (e) {
      toast.error("Errore nella creazione dell'ordine");
      console.error(e);
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
        <div className="space-y-3 mb-4">
          {items.map((item) => (
            <div key={item.id} className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--bg-primary)" }}>
                <Package size={18} style={{ color: "var(--text-muted)" }} />
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
                <p className="text-xs font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                  {formatEuro(item.prezzo * item.quantita)}
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
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{formatEuro(totals.subtotale)}</span>
          </div>
          <div className="flex justify-between text-xs" style={{ fontFamily: "var(--font-montserrat)" }}>
            <span style={{ color: "var(--text-secondary)" }}>PFU</span>
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{formatEuro(totals.pfu)}</span>
          </div>
          <div className="flex justify-between text-xs" style={{ fontFamily: "var(--font-montserrat)" }}>
            <span style={{ color: "var(--text-secondary)" }}>Contrib. logistico</span>
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{formatEuro(totals.contributoLogistico)}</span>
          </div>
          <div className="flex justify-between text-xs" style={{ fontFamily: "var(--font-montserrat)" }}>
            <span style={{ color: "var(--text-secondary)" }}>IVA (22%)</span>
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{formatEuro(totals.iva)}</span>
          </div>
          <div className="flex justify-between pt-2 border-t" style={{ borderColor: "var(--border)" }}>
            <span className="font-bold text-sm" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>Totale</span>
            <span className="font-bold text-sm" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>{formatEuro(totals.totale)}</span>
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
            {savedAddresses.length > 0 && (
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
            Metodo di pagamento
          </h2>
          <div className="space-y-3">
            {metodiPagamento.map((m) => (
              <label
                key={m.id}
                className="flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-all"
                style={{
                  border: metodo === m.id ? "2px solid var(--brand)" : "2px solid var(--border)",
                  background: metodo === m.id ? "rgba(255,200,3,0.05)" : "transparent",
                }}
              >
                <input
                  type="radio"
                  name="metodo"
                  value={m.id}
                  checked={metodo === m.id}
                  onChange={() => setMetodo(m.id)}
                  className="accent-yellow-400"
                />
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                  {m.label}
                </span>
              </label>
            ))}
          </div>
        </Card>
      );
    }

    if (step === 3) {
      const metodoLabel = metodiPagamento.find((m) => m.id === metodo)?.label ?? "";
      return (
        <Card>
          <h2 className="text-lg font-bold mb-5" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>
            Conferma ordine
          </h2>
          <div className="space-y-5">
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
              <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                Metodo di pagamento
              </p>
              <p className="text-sm" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                {metodoLabel}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                Articoli ({items.length})
              </p>
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                      {item.marca} {item.modello} × {item.quantita}
                    </span>
                    <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)", fontWeight: 600 }}>
                      {formatEuro(item.prezzo * item.quantita)}
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
                {formatEuro(totals.totale)}
              </span>
            </div>
          </div>
        </Card>
      );
    }

    return null;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}>
        Checkout
      </h1>

      <StepIndicator current={step} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-4">
          <StepContent />

          <div className="flex items-center justify-between gap-4">
            {step > 0 ? (
              <button
                onClick={() => setStep((s) => s - 1)}
                disabled={submitting}
                className="px-6 py-2.5 rounded-full text-sm font-semibold transition-colors"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
              >
                Indietro
              </button>
            ) : (
              <div />
            )}
            {step < 3 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                className="px-6 py-2.5 rounded-full text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                Avanti
              </button>
            ) : (
              <button
                onClick={handleConfirm}
                disabled={submitting}
                className="flex items-center gap-2 px-8 py-2.5 rounded-full text-sm font-semibold disabled:opacity-60"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                Conferma ordine
              </button>
            )}
          </div>
        </div>

        <div className="lg:col-span-1 sticky top-6">
          <OrderSummary />
        </div>
      </div>
    </div>
  );
}
