"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
  collection, query, orderBy, getDocs, getDoc, getCountFromServer,
  where, limit, onSnapshot, doc, updateDoc, addDoc, serverTimestamp, Timestamp,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/layout/AuthProvider";
import { ShoppingBag, Search, X, Eye, Truck, Download, Check, MapPin, RefreshCw, Package2, CalendarDays, ChevronDown, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import CalendarRangePicker from "@/components/ui/CalendarRangePicker";
import AnchoredPopover from "@/components/ui/AnchoredPopover";
import HeaderFilter from "@/components/ui/HeaderFilter";
import toast from "react-hot-toast";
import { searchOrdini, type OrdiniSearchField } from "@/lib/algolia";
import { trackGlsJob } from "@/lib/gls/jobTracking";
import type { Ordine, OrdineStato, OrdineSource } from "@/lib/types";

// ─── Constants ─────────────────────────────────────────────────────────────────

// Allineato a FFAppConstants.StatoOrdine
const STATI: OrdineStato[] = [
  "In Lavorazione",
  "In Preparazione",
  "Spedito",
  "Consegnato",
  "Annullato",
  "Out of Stock",
  "Cancellato Tyre24",
  "Cancellato Cliente",
];

// Stati che un admin NON può impostare manualmente (gestiti dal sistema)
const STATI_READONLY: ReadonlySet<string> = new Set(["Cancellato Tyre24", "Cancellato Cliente"]);

// Stati legacy/di sistema presenti nei dati storici ma NON impostabili manualmente.
// Inclusi SOLO nel filtro Stato (non nel menu di modifica inline) così sono ricercabili.
const STATI_EXTRA_FILTRO = ["Completato", "In Sospeso", "Unknown"];
const STATI_FILTRO = [...STATI, ...STATI_EXTRA_FILTRO];

// Valori reali del campo Ordini.Source su Firestore. NB: il canale Tyre24 è
// salvato come "Tyre24" (NON "T24") — allineato alla pagina Spedizioni.
const FONTI = ["B2B", "eBay", "Amazon", "WooCommerce", "Tyre24", "Prezzo-Gomme", "AdTyres", "Anonimo", "Vetrina", "API"];

const FONTE_COLORS: Record<string, { bg: string; text: string }> = {
  B2B:            { bg: "#FFC803", text: "#111" },
  eBay:           { bg: "#92C821", text: "#fff" },
  Amazon:         { bg: "#2196F3", text: "#fff" },
  WooCommerce:    { bg: "#7F54B3", text: "#fff" },
  Tyre24:         { bg: "#EC7522", text: "#fff" },
  "Prezzo-Gomme": { bg: "#1565C0", text: "#fff" },
  AdTyres:        { bg: "#E8E8E8", text: "#374151" },
  Anonimo:        { bg: "#E8E8E8", text: "#374151" },
  Vetrina:        { bg: "#0F766E", text: "#fff" },
  API:            { bg: "#475569", text: "#fff" },
};

// Colore di sfondo del trigger del dropdown stato (ispirato al FF)
const STATO_PILL: Record<string, { bg: string; text: string; border: string }> = {
  "In Lavorazione":     { bg: "#FFFBEB", text: "#92400E", border: "#FDE68A" },
  "In Preparazione":    { bg: "#FFF8DC", text: "#854D0E", border: "#FCD34D" },
  "Spedito":            { bg: "#DBEAFE", text: "#1E40AF", border: "#93C5FD" },
  "Consegnato":         { bg: "#DCFCE7", text: "#166534", border: "#86EFAC" },
  "Annullato":          { bg: "#FEE2E2", text: "#991B1B", border: "#FCA5A5" },
  "Out of Stock":       { bg: "#FEF3C7", text: "#92400E", border: "#FDE68A" },
  "Cancellato Tyre24":  { bg: "#F3F4F6", text: "#4B5563", border: "#D1D5DB" },
  "Cancellato Cliente": { bg: "#F3F4F6", text: "#4B5563", border: "#D1D5DB" },
};

// ─── Types ─────────────────────────────────────────────────────────────────────

type OrdineEntry = { ordine: Ordine; clienteNome: string; docId: string };
type KPIs = { totale: number; daEvadere: number; inTransito: number; annullati: number };

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getTodayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function batchGetDocs(refs: DocumentReference[]): Promise<Map<string, Record<string, unknown>>> {
  if (refs.length === 0) return new Map();
  const unique = [...new Map(refs.map((r) => [r.path, r])).values()];
  const snaps = await Promise.all(unique.map((r) => getDoc(r)));
  const map = new Map<string, Record<string, unknown>>();
  snaps.forEach((s) => {
    if (s.exists()) map.set(s.ref.path, { id: s.id, ...s.data() } as Record<string, unknown>);
  });
  return map;
}

// Estrae il "Destinatario" da un indirizzo (mappa Firestore con chiavi underscore).
function destinatarioFromAddr(addr: unknown): string {
  if (addr && typeof addr === "object") {
    const d = (addr as Record<string, unknown>).Destinatario;
    if (typeof d === "string") return d.trim();
  }
  return "";
}

// Nome mostrato in lista — mirror FF (ordini_row): destinatario di FATTURAZIONE,
// tranne per le fonti Anonimo/AdTyres (o se manca) → destinatario di SPEDIZIONE.
function nomeDaOrdine(ordine: Ordine): string {
  const raw = ordine as unknown as Record<string, unknown>;
  const fatt = destinatarioFromAddr(raw.Indirizzo_Fatturazione);
  const sped = destinatarioFromAddr(raw.Indirizzo_Spedizione);
  const source = String(ordine.Source ?? "");
  const useSped = source === "Anonimo" || source === "AdTyres" || !fatt;
  return (useSped ? sped : fatt) || "";
}

// Risolve il nome cliente per una lista di ordini seguendo la logica del FF
// (destinatario fatturazione/spedizione), con fallback sui riferimenti
// Cliente → Ragione_Sociale/Nome / Utente → display_name/email. Usato sia dal
// caricamento normale sia dai risultati di ricerca Algolia: le viste coincidono.
async function resolveOrdineEntries(raw: { docId: string; ordine: Ordine }[]): Promise<OrdineEntry[]> {
  const clienteRefs = raw.map(({ ordine }) => ordine.Cliente).filter(Boolean) as DocumentReference[];
  const utenteRefs  = raw.map(({ ordine }) => ordine.Utente).filter(Boolean) as DocumentReference[];
  const [clientiMap, utentiMap] = await Promise.all([
    batchGetDocs(clienteRefs),
    batchGetDocs(utenteRefs),
  ]);
  return raw.map(({ ordine, docId }) => {
    let clienteNome = nomeDaOrdine(ordine);
    if (!clienteNome) {
      // Fallback sul riferimento quando gli indirizzi non hanno un destinatario
      if (ordine.Cliente) {
        const c = clientiMap.get(ordine.Cliente.path);
        // Azienda è un booleano nello schema Clienti → non usarlo come nome
        if (c) clienteNome = String(c.Ragione_Sociale || c.Nome || "").trim();
      } else if (ordine.Utente) {
        const u = utentiMap.get(ordine.Utente.path);
        // Campo reale users: display_name (snake_case); displayName come fallback legacy
        if (u) clienteNome = String(u.display_name || u.displayName || u.email || "");
      }
    }
    return { ordine, clienteNome: clienteNome || "—", docId };
  });
}

function getTs(ordine: Ordine): Timestamp | undefined {
  const o = ordine as unknown as Record<string, Timestamp>;
  return o.DataOra ?? o.dataOra ?? o.data_ora ?? o.DataCreazione ?? o.createdAt ?? o.created_time;
}

function formatData(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "—";
  const d = ts.toDate();
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" })
    + " " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function formatEuro(n: number | undefined | null) {
  if (n == null) return "—";
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function formatISOToDisplay(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// ─── SpedizioneModal ───────────────────────────────────────────────────────────

type Spedizione = {
  id: string;
  Corriere?: string;
  parcelId?: string;
  destinationName?: string;
  warehouseStatus?: string;
  contractIndex?: number;
  motivoAnnullamento?: string;
  noteAggiuntive?: string;
};

const WAREHOUSE_STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  "In Preparazione": { bg: "#FFF8DC", text: "#B45309" },
  "Spedito":         { bg: "#DCFCE7", text: "#166534" },
  "Annullato":       { bg: "#FEE2E2", text: "#991B1B" },
};

function SpedizioneModal({ docId, orderId, onClose }: { docId: string; orderId: string; onClose: () => void }) {
  const [spedizioni, setSpedizioni] = useState<Spedizione[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, "Ordini", docId);
    const q = query(
      collection(db, "Spedizioni"),
      where("orderReference", "==", ref),
      orderBy("createdAt", "desc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setSpedizioni(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Spedizione)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [docId]);

  const SEDE = ["Nola", "Roma"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full overflow-hidden"
        style={{ maxWidth: 520, fontFamily: "var(--font-montserrat)" }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #f3f4f6" }}>
          <div className="flex items-center gap-2.5">
            <Truck size={18} style={{ color: "#FFC803" }} />
            <div>
              <h2 className="text-sm font-bold" style={{ color: "#111", fontFamily: "var(--font-poppins)" }}>
                Spedizioni
              </h2>
              <p className="text-xs" style={{ color: "#9ca3af" }}>Ordine {orderId}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors">
            <X size={18} style={{ color: "#374151" }} />
          </button>
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "#f3f4f6" }} />
              ))}
            </div>
          ) : spedizioni.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <Package2 size={36} style={{ color: "#d1d5db" }} />
              <p className="text-sm font-semibold" style={{ color: "#374151" }}>Nessuna spedizione</p>
              <p className="text-xs" style={{ color: "#9ca3af" }}>Non ci sono spedizioni associate a questo ordine</p>
            </div>
          ) : (
            <div className="space-y-3">
              {spedizioni.map((s) => {
                const statusStyle = WAREHOUSE_STATUS_STYLE[s.warehouseStatus ?? ""] ?? { bg: "#f3f4f6", text: "#374151" };
                return (
                  <div key={s.id} className="rounded-xl p-3.5" style={{ border: "1px solid #e5e7eb" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-bold"
                          style={{ background: s.Corriere === "GLS" ? "#003DA5" : "#E8001C", color: "#fff" }}
                        >
                          {s.Corriere ?? "—"}
                        </span>
                        {s.Corriere === "GLS" && s.contractIndex != null && (
                          <span className="text-xs font-semibold" style={{ color: "#6b7280" }}>
                            {SEDE[s.contractIndex] ?? `Sede ${s.contractIndex}`}
                          </span>
                        )}
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ background: statusStyle.bg, color: statusStyle.text }}
                        >
                          {s.warehouseStatus ?? "—"}
                        </span>
                      </div>
                    </div>
                    {s.parcelId && (
                      <p className="mt-2 text-sm font-bold font-mono" style={{ color: "#111" }}>
                        {s.parcelId}
                      </p>
                    )}
                    {s.destinationName && (
                      <p className="mt-1 text-xs" style={{ color: "#6b7280" }}>
                        <MapPin size={10} className="inline mr-1" />
                        {s.destinationName}
                      </p>
                    )}
                    {s.motivoAnnullamento && (
                      <p className="mt-1.5 text-xs px-2 py-1 rounded-lg" style={{ background: "#FEE2E2", color: "#991B1B" }}>
                        {s.motivoAnnullamento}
                      </p>
                    )}
                    {s.noteAggiuntive && (
                      <p className="mt-1 text-xs" style={{ color: "#9ca3af" }}>{s.noteAggiuntive}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function OrdiniAdminPage() {
  const [entries, setEntries] = useState<OrdineEntry[]>([]);
  const [kpis, setKpis]       = useState<KPIs | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [stato, setStato]   = useState<string>(""); // include stati legacy nel filtro
  const [fonte, setFonte]   = useState("");

  // Ricerca Algolia su TUTTI gli ordini (mirror FF). searchField = dropdown
  // "Numero Ordine / Nome / Dati Spedizione". searchEntries: null = non in
  // ricerca (mostra la lista per data); array = risultati Algolia risolti.
  const [searchField, setSearchField]     = useState<OrdiniSearchField>("Numero Ordine");
  const [searchEntries, setSearchEntries] = useState<OrdineEntry[] | null>(null);
  const [searching, setSearching]         = useState(false);
  const [dataDa, setDataDa] = useState(getTodayISO);
  const [dataA, setDataA]   = useState(getTodayISO);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const datePickerRef = useRef<HTMLDivElement>(null);
  const [showFilters, setShowFilters] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [spedizioneModal, setSpedizioneModal] = useState<{ docId: string; orderId: string } | null>(null);

  // Card mobile espandibili (tendina) — set dei docId aperti
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  function toggleOrderDetails(id: string) {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const [savingStato, setSavingStato] = useState<string | null>(null);
  const [annullaModal, setAnnullaModal] = useState<{ docId: string; orderId: string } | null>(null);
  const [motivoAnnulla, setMotivoAnnulla] = useState("");
  const [annullando, setAnnullando] = useState(false);
  const [spedendo, setSpedendo] = useState<"Roma" | "Nola" | null>(null);
  const [aggiornandoTracking, setAggiornandoTracking] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const { user } = useAuth();

  // I job GLS bulk girano in background: quando uno termina (il widget
  // SpedizioniJobs lo de-traccia emettendo "gls-job-removed") ri-fetchiamo la
  // lista così gli ordini appena passati a "In Preparazione" si aggiornano
  // senza che l'admin debba cambiare intervallo date a mano.
  useEffect(() => {
    const onJobDone = () => setReloadKey((k) => k + 1);
    window.addEventListener("gls-job-removed", onJobDone);
    return () => window.removeEventListener("gls-job-removed", onJobDone);
  }, []);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  // Re-fetch whenever the date range changes — server-side date filter for accuracy
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const daDate = new Date(dataDa + "T00:00:00");
        const aDate  = new Date(dataA  + "T23:59:59");
        const daTsamp = Timestamp.fromDate(daDate);
        const aTsamp  = Timestamp.fromDate(aDate);

        const [ordiniSnap, kpiTotale, kpiDaEvadere, kpiTransito, kpiAnnullati] = await Promise.all([
          getDocs(query(
            collection(db, "Ordini"),
            where("DataOra", ">=", daTsamp),
            where("DataOra", "<=", aTsamp),
            orderBy("DataOra", "desc"),
            limit(2000),
          )),
          getCountFromServer(collection(db, "Ordini")),
          getCountFromServer(query(collection(db, "Ordini"), where("Stato", "in", ["In Lavorazione", "In Preparazione"]))),
          getCountFromServer(query(collection(db, "Ordini"), where("Stato", "==", "Spedito"))),
          getCountFromServer(query(collection(db, "Ordini"), where("Stato", "==", "Annullato"))),
        ]);

        setKpis({
          totale:     kpiTotale.data().count,
          daEvadere:  kpiDaEvadere.data().count,
          inTransito: kpiTransito.data().count,
          annullati:  kpiAnnullati.data().count,
        });

        const ordini = ordiniSnap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            // Numero ordine: campo schema "ID"; fallback su "id" legacy e infine sul doc id
            return { docId: d.id, ordine: { ...data, id: data.ID ?? data.id ?? d.id } as Ordine };
          })
          .sort((a, b) => (getTs(b.ordine)?.toMillis() ?? 0) - (getTs(a.ordine)?.toMillis() ?? 0));

        const resolved = await resolveOrdineEntries(ordini);
        setEntries(resolved);
      } catch (e) {
        toast.error("Errore nel caricamento ordini");
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataDa, dataA, reloadKey]);

  const inSearch = searchEntries !== null;

  // ── Filter ─────────────────────────────────────────────────────────────────
  // In modalità ricerca la base è searchEntries (Algolia, tutti gli ordini) e il
  // testo è già stato applicato da Algolia; altrimenti è la lista caricata per
  // data e il testo filtra client-side. Fonte/Stato restano attivi in entrambi.
  const filtered = useMemo(() => {
    const base = searchEntries ?? entries;
    return base.filter(({ ordine, clienteNome }) => {
      if (!inSearch && search) {
        const hay = [ordine.id, clienteNome, String(ordine.Totale ?? "")].join(" ").toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      if (stato && ordine.Stato  !== stato) return false;
      if (fonte && ordine.Source !== fonte) return false;
      return true;
    });
  }, [entries, searchEntries, inSearch, search, stato, fonte]);

  // Fatturato del periodo (escludi tutti gli stati di cancellazione)
  const fatturato = useMemo(() => {
    const excluded = new Set(["Annullato", "Out of Stock", "Cancellato Tyre24", "Cancellato Cliente"]);
    return filtered
      .filter(({ ordine }) => !excluded.has(ordine.Stato))
      .reduce((acc, { ordine }) => acc + (ordine.Totale ?? 0), 0);
  }, [filtered]);

  const today = getTodayISO();
  const hasExtraFilters = !!(search || stato || fonte || inSearch);
  const isDefaultRange  = dataDa === today && dataA === today;

  // Esegui la ricerca Algolia su tutti gli ordini (mirror FF: OrdiniRecord.search).
  // Costruisce OrdineEntry dai hit (Cliente path → ref, DataOra millis → Timestamp)
  // e risolve i nomi cliente con lo stesso pipeline della lista normale.
  async function handleSearchOrdini() {
    const term = search.trim();
    if (!term) { setSearchEntries(null); setSelectedIds(new Set()); return; }
    setSearching(true);
    try {
      const hits = await searchOrdini(term, searchField);
      // Ricostruisce un DocumentReference dal path stringa dell'hit (Algolia non
      // serializza i reference); path malformato → undefined (nome → "—").
      const refFromPath = (path?: string): DocumentReference | undefined => {
        if (!path) return undefined;
        try { return doc(db, path); } catch { return undefined; }
      };
      const raw = hits
        .map((h) => {
          const docId = h.objectID || (h.path ? h.path.split("/").pop() ?? "" : "");
          const ordine = {
            ...(h as Record<string, unknown>),
            id:      h.ID ?? docId,
            DataOra: typeof h.DataOra === "number" ? Timestamp.fromMillis(h.DataOra) : undefined,
            Cliente: refFromPath(h.Cliente),
            Utente:  refFromPath(h.Utente),
          } as unknown as Ordine;
          return { docId, ordine };
        })
        .filter((e) => e.docId);
      const resolved = await resolveOrdineEntries(raw);
      setSearchEntries(resolved);
      setSelectedIds(new Set());
    } catch (e) {
      console.error(e);
      toast.error("Errore nella ricerca ordini");
      setSearchEntries([]);
    } finally {
      setSearching(false);
    }
  }

  // Esci dalla ricerca: torna alla lista filtrata per data.
  function exitSearch() {
    setSearch("");
    setSearchEntries(null);
    setSelectedIds(new Set());
  }

  function reset() {
    setSearch(""); setStato(""); setFonte(""); setSearchEntries(null);
  }

  function resetRange() {
    setDataDa(today); setDataA(today); setSearchEntries(null);
  }

  // ── Selezione ──────────────────────────────────────────────────────────────
  const allSelected  = filtered.length > 0 && selectedIds.size === filtered.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(filtered.map((e) => e.docId)));
  }

  // Notifica il marketplace di origine (Tyre24/Anonimo/eBay/Amazon/AdTyres) via
  // /api/marketplace. Automatico al cambio stato — stesso mirror FF stato_ordine
  // già in produzione nella pagina di dettaglio ordine.
  async function notifyMarketplace(body: Record<string, unknown>, label: string) {
    const t = toast.loading(`Sincronizzazione ${label}…`);
    try {
      const res = await fetch("/api/marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null) as { success?: boolean; error?: string; data?: { ok?: boolean; skipped?: boolean; detail?: string } } | null;
      toast.dismiss(t);
      const d = data?.data;
      if (d?.skipped) return;                       // fonte senza marketplace: nessun avviso
      if (res.ok && data?.success && d?.ok) toast.success(d?.detail || `${label}: sincronizzato`);
      else toast.error(d?.detail || data?.error || `Errore sincronizzazione ${label}`);
    } catch {
      toast.dismiss(t);
      toast.error(`Errore sincronizzazione ${label}`);
    }
  }

  // ── Cambio stato inline (per riga) ─────────────────────────────────────────
  async function handleRowStatoChange(docId: string, nuovoStato: OrdineStato, prevStato: OrdineStato, ordine: Ordine) {
    if (savingStato || nuovoStato === prevStato) return;
    const orderId = ordine.id ?? docId;

    // Stati impostabili solo dal sistema: blocco con avviso
    if (STATI_READONLY.has(nuovoStato)) {
      toast.error("Non sei autorizzato a impostare questo stato");
      return;
    }

    // Annullato: apri modal motivo (mirror MotivoAnnullamentoWidget del FF)
    if (nuovoStato === "Annullato") {
      setAnnullaModal({ docId, orderId });
      setMotivoAnnulla("");
      return;
    }

    // Spedito richiede il codice tracking (come FF e come il dettaglio ordine:
    // senza tracking → errore, niente cambio stato né push marketplace)
    if (nuovoStato === "Spedito" && !(ordine.GLS_TrackingNumber ?? "").trim()) {
      toast.error("Codice tracking assente: inseriscilo dal dettaglio ordine prima di segnare 'Spedito'.");
      return;
    }

    setSavingStato(docId);
    try {
      await updateDoc(doc(db, "Ordini", docId), {
        Stato:             nuovoStato,
        DataAggiornamento: serverTimestamp(),
      });
      await addDoc(collection(db, "Ordini", docId, "Cronologia"), {
        DataOra:   serverTimestamp(),
        Operatore: user?.displayName || user?.email || "Operatore",
        Azione:    `Stato → ${nuovoStato}`,
        Nota:      "",
      });
      // Aggiornamento ottimistico in lista
      setEntries((prev) =>
        prev.map((e) => e.docId === docId ? { ...e, ordine: { ...e.ordine, Stato: nuovoStato } } : e)
      );
      toast.success(`Stato: ${nuovoStato}`);

      // ── Side-effect marketplace automatico (mirror FF stato_ordine, identico
      // al ramo già in produzione nel dettaglio ordine) ──
      const src = ordine.Source as string;
      const isT24like     = src === "Tyre24" || src === "Anonimo";
      const isMarketplace = ["Tyre24", "Anonimo", "eBay", "Amazon", "AdTyres"].includes(src);
      if (nuovoStato === "In Preparazione" && isT24like) {
        notifyMarketplace(
          { action: "updateStatus", ordineId: docId, statusIndex: 2, comment: "We’ve received your order and are now processing it." },
          src,
        );
      } else if (nuovoStato === "Out of Stock" && isT24like) {
        notifyMarketplace(
          { action: "updateStatus", ordineId: docId, statusIndex: 5, comment: "We are sorry, but we have run out of stock and therefore had to cancel your order." },
          src,
        );
      } else if (nuovoStato === "Out of Stock" && src === "eBay") {
        notifyMarketplace({ action: "outOfStock", ordineId: docId }, src);
      } else if (nuovoStato === "Spedito" && isMarketplace) {
        notifyMarketplace({ action: "pushTracking", ordineId: docId, corriere: ordine.Corriere }, src);
      }
    } catch {
      toast.error("Errore aggiornamento stato");
    } finally {
      setSavingStato(null);
    }
  }

  async function handleConfermaAnnulla() {
    if (!annullaModal || annullando) return;
    const motivo = motivoAnnulla.trim();
    if (!motivo) {
      toast.error("Inserisci il motivo dell'annullamento");
      return;
    }
    setAnnullando(true);
    try {
      await updateDoc(doc(db, "Ordini", annullaModal.docId), {
        Stato:               "Annullato",
        Motivo_Annullamento: motivo,
        DataAggiornamento:   serverTimestamp(),
      });
      await addDoc(collection(db, "Ordini", annullaModal.docId, "Cronologia"), {
        DataOra:   serverTimestamp(),
        Operatore: user?.displayName || user?.email || "Operatore",
        Azione:    "Stato → Annullato",
        Nota:      motivo,
      });
      setEntries((prev) =>
        prev.map((e) => e.docId === annullaModal.docId
          ? { ...e, ordine: { ...e.ordine, Stato: "Annullato", Motivo_Annullamento: motivo } }
          : e)
      );
      setAnnullaModal(null);
      setMotivoAnnulla("");
      toast.success("Ordine annullato");
    } catch {
      toast.error("Errore annullamento ordine");
    } finally {
      setAnnullando(false);
    }
  }

  // Export CSV — mirror FF (custom action exportOrders): 12 colonne, con PFU e
  // Prezzo_Acquisto calcolati leggendo i Prodotti. Fatto server-side (/api/export-orders)
  // perché richiede le letture dei prodotti e i campi grezzi degli articoli.
  async function handleExportSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) { toast.error("Nessun ordine selezionato"); return; }
    const toastId = toast.loading(`Esportazione ${ids.length} ordini…`);
    try {
      const res = await fetch("/api/export-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordiniIds: ids }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const csv = await res.text();
      // BOM per compatibilità Excel con gli accenti.
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `ordini_export_${ids.length}.csv`; a.click();
      URL.revokeObjectURL(url);
      toast.dismiss(toastId);
      toast.success(`Esportati ${ids.length} ordini`);
    } catch (e) {
      toast.dismiss(toastId);
      toast.error(`Errore export: ${e instanceof Error ? e.message : "sconosciuto"}`);
    }
  }

  // Push del tracking ai marketplace per una lista di ordini (mirror FF: dopo
  // "Spedisci" e su "Aggiorna Tracking"). Dispatch per Source lato server
  // (/api/marketplace · pushTracking). `entries` = [ordineId, corriere].
  // Le fonti senza marketplace (B2B/WooCommerce/Prezzo-Gomme) risultano "skipped".
  async function pushMarketplaceEntries(entries: [string, string][]): Promise<{ ok: number; ko: number; skipped: number }> {
    const results = await Promise.allSettled(
      entries.map(([ordineId, corriere]) =>
        fetch("/api/marketplace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pushTracking", ordineId, corriere }),
        }).then(async (res) => {
          const data = await res.json().catch(() => null) as { error?: string; data?: { ok?: boolean; skipped?: boolean } } | null;
          if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
          return data?.data ?? { ok: false };
        })
      )
    );
    let ok = 0, ko = 0, skipped = 0;
    for (const r of results) {
      if (r.status === "fulfilled") { if (r.value?.skipped) skipped++; else if (r.value?.ok) ok++; else ko++; }
      else ko++;
    }
    return { ok, ko, skipped };
  }

  function mkLabel({ ok, ko, skipped }: { ok: number; ko: number; skipped: number }): string {
    const parts: string[] = [];
    if (ok) parts.push(`${ok} ok`);
    if (skipped) parts.push(`${skipped} n/d`);
    if (ko) parts.push(`${ko} falliti`);
    return parts.length ? ` · marketplace: ${parts.join(", ")}` : "";
  }

  // Spedisci Nola/Roma — avvia un job di creazione spedizioni GLS in background
  // (route /api/gls-italy crea il job Firestore e processa gli ordini uno a uno,
  // marketplace incluso). L'utente non aspetta il batch: riceve subito il jobId,
  // lo traccia (SpedizioniJobsWidget nel layout admin segue il progresso live
  // su qualunque pagina) e può continuare a lavorare. La lista ordini NON è
  // realtime (fetch one-shot via getDocs), quindi ri-fetchiamo quando il job
  // termina, via l'evento "gls-job-removed" ascoltato nell'effect sopra.
  async function handleSpedisci(sede: "Roma" | "Nola") {
    if (spedendo || aggiornandoTracking) return;
    const ids = [...selectedIds];
    if (ids.length === 0) { toast.error("Nessun ordine selezionato"); return; }

    const contractIndex = sede === "Nola" ? 0 : 1;
    setSpedendo(sede);
    try {
      const res = await fetch(
        "/api/gls-italy",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action:        "processMultipleOrders",
            contractIndex,
            ordiniIds:     ids,
          }),
        }
      );
      const data = await res.json().catch(() => null) as { jobId?: string; error?: string } | null;
      if (!res.ok || !data?.jobId) throw new Error(data?.error || `Errore ${res.status}`);
      trackGlsJob(data.jobId);
      toast.success(`Spedizione GLS ${sede} avviata (${ids.length} ordini) — segui il progresso in basso a destra`);
      setSelectedIds(new Set());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Errore sconosciuto";
      toast.error(`Errore avvio spedizione GLS (${sede}): ${msg}`);
    } finally {
      setSpedendo(null);
    }
  }

  // Aggiorna Tracking — mirror FF (pagina ordini): comunica il tracking al
  // marketplace di origine di ogni ordine selezionato (Tyre24/Anonimo → Alzura,
  // eBay, Amazon, AdTyres) via /api/marketplace. NON rigenera lo ZPL (quella è
  // un'azione del dettaglio ordine). Il corriere per ordine viene dal campo
  // Corriere dell'ordine (default GLS). Le fonti senza marketplace sono saltate.
  async function handleAggiornaTracking() {
    if (spedendo || aggiornandoTracking) return;
    const rows = filtered.filter((e) => selectedIds.has(e.docId));
    if (rows.length === 0) { toast.error("Nessun ordine selezionato"); return; }
    const entries: [string, string][] = rows.map((r) => [r.docId, r.ordine.Corriere ?? "GLS"]);

    setAggiornandoTracking(true);
    const toastId = toast.loading(`Aggiornamento tracking marketplace — ${entries.length} ordini…`);
    try {
      const mk = await pushMarketplaceEntries(entries);
      toast.dismiss(toastId);
      const parts: string[] = [];
      if (mk.ok) parts.push(`${mk.ok} aggiornati`);
      if (mk.skipped) parts.push(`${mk.skipped} senza marketplace`);
      if (mk.ko) parts.push(`${mk.ko} falliti`);
      const summary = parts.join(", ") || "nessuna operazione";
      if (mk.ko === 0) toast.success(`Tracking marketplace: ${summary}`);
      else toast.error(`Tracking marketplace: ${summary}`);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.dismiss(toastId);
      toast.error(`Errore aggiornamento tracking: ${e instanceof Error ? e.message : "sconosciuto"}`);
    } finally {
      setAggiornandoTracking(false);
    }
  }

  // ── Date range display ─────────────────────────────────────────────────────
  const dateRangeLabel = dataDa === dataA
    ? formatISOToDisplay(dataDa)
    : `${formatISOToDisplay(dataDa)} - ${formatISOToDisplay(dataA)}`;

  // ── KPI cards ──────────────────────────────────────────────────────────────
  const kpiCards = [
    { label: "Totale ordini",  value: kpis?.totale    ?? 0, accent: "#FFC803" },
    { label: "Da evadere",     value: kpis?.daEvadere  ?? 0, accent: "#EE8B60" },
    { label: "In transito",    value: kpis?.inTransito ?? 0, accent: "#249689" },
    { label: "Annullati",      value: kpis?.annullati  ?? 0, accent: "#FF5963" },
  ];

  return (
    <div className="px-0 md:px-5 py-3 md:py-5 space-y-2.5 md:space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
            Ordini
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
            Tutti i canali: B2B, eBay, Amazon, WooCommerce
          </p>
        </div>
        <a
          href="/api/admin/ordini/export"
          download
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors hover:bg-[#FFF8DC]"
          style={{ border: "1px solid #FFC803", color: "#111", fontFamily: "var(--font-montserrat)", background: "#fff" }}
        >
          <Download size={15} /> Esporta CSV
        </a>
      </div>

      {/* KPI cards — nascoste su mobile (occupano troppo spazio), visibili da md in su */}
      <div className="hidden md:grid grid-cols-2 xl:grid-cols-4 gap-2.5 md:gap-4">
        {kpiCards.map(({ label, value, accent }) => (
          <div
            key={label}
            className="rounded-xl md:rounded-2xl p-2.5 md:p-5 overflow-hidden"
            style={{ background: "#fff", border: "1px solid #e5e7eb" }}
          >
            <div className="flex items-center justify-between gap-1.5 mb-0.5 md:mb-2">
              <span className="min-w-0 text-[9px] md:text-[10px] font-bold uppercase tracking-wider leading-tight break-words" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>
                {label}
              </span>
              <div className="w-5 h-5 md:w-7 md:h-7 rounded-md md:rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${accent}22` }}>
                <ShoppingBag className="w-3 h-3 md:w-3.5 md:h-3.5" style={{ color: accent }} />
              </div>
            </div>
            {loading ? (
              <div className="h-6 md:h-8 w-12 md:w-14 rounded animate-pulse" style={{ background: "#f3f4f6" }} />
            ) : (
              <p className="text-lg md:text-3xl font-black leading-none truncate" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
                {value}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Filter bar — ricerca + reset. Su desktop Fonte/Stato sono nell'intestazione tabella
          (come la sezione Spedizioni); su mobile in un pannello collassabile. */}
      <div className="space-y-2">
       <div className="flex gap-2 items-center flex-wrap">
        {/* Selettore campo di ricerca — mirror FF (Numero Ordine / Nome / Dati Spedizione) */}
        <div className="relative flex-shrink-0">
          <select
            value={searchField}
            onChange={(e) => setSearchField(e.target.value as OrdiniSearchField)}
            title="Campo di ricerca"
            className="appearance-none pl-3 pr-8 py-2 rounded-xl text-sm font-semibold outline-none cursor-pointer"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "#111", fontFamily: "var(--font-montserrat)" }}
          >
            {(["Numero Ordine", "Nome", "Dati Spedizione"] as OrdiniSearchField[]).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#9ca3af" }} />
        </div>

        {/* Campo di ricerca + pulsante — ricerca Algolia su TUTTI gli ordini (mirror FF).
            Invio o click su "Cerca" avviano la ricerca; la X esce e torna alla lista per data. */}
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <div className="relative flex-1 min-w-[130px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearchOrdini(); }}
              placeholder="Cerca…"
              className="w-full pl-9 pr-8 py-2 rounded-xl text-sm outline-none"
              style={{ background: "var(--bg-primary)", border: `1px solid ${inSearch ? "#FFC803" : "var(--border)"}`, fontFamily: "var(--font-montserrat)" }}
            />
            {(search || inSearch) && (
              <button
                onClick={exitSearch}
                title="Esci dalla ricerca"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100"
              >
                <X size={13} style={{ color: "#9ca3af" }} />
              </button>
            )}
          </div>
          <button
            onClick={handleSearchOrdini}
            disabled={searching}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold flex-shrink-0 transition-all hover:brightness-95 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
          >
            {searching ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
            <span className="hidden sm:inline">Cerca</span>
          </button>
        </div>

        {/* Desktop: reset filtri a destra */}
        {hasExtraFilters && (
          <button onClick={reset}
            className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-colors hover:bg-white ml-auto"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
            <RefreshCw size={13} /> Reset
          </button>
        )}

        {/* Mobile: toggle Filtri */}
        <button onClick={() => setShowFilters((v) => !v)}
          className="md:hidden flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold flex-shrink-0 transition-colors"
          style={{ background: showFilters ? "#FFC803" : "var(--bg-primary)", border: "1px solid var(--border)", color: "#111", fontFamily: "var(--font-montserrat)" }}>
          <SlidersHorizontal size={14} /> Filtri
          {(() => { const n = [fonte, stato].filter(Boolean).length; return n > 0 ? (
            <span className="w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: "#111", color: "#FFC803" }}>{n}</span>
          ) : null; })()}
          <ChevronDown size={14} style={{ transform: showFilters ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
        </button>
        {hasExtraFilters && (
          <button onClick={reset}
            className="md:hidden flex items-center gap-1 px-3 py-2 rounded-xl text-sm flex-shrink-0"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
            <X size={13} />
          </button>
        )}
       </div>

       {/* Mobile: pannello filtri collassabile (Fonte · Stato) */}
       <div className={`${showFilters ? "flex" : "hidden"} md:hidden gap-2 flex-wrap items-center`}>
        <select value={fonte} onChange={(e) => setFonte(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm outline-none"
          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
          <option value="">Tutte le fonti</option>
          {FONTI.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={stato} onChange={(e) => setStato(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm outline-none"
          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
          <option value="">Tutti gli stati</option>
          {STATI_FILTRO.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
       </div>
      </div>

      {/* Stats bar — fatturato + contatore + date range picker */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Fatturato */}
        <div className="flex items-center px-4 py-2 rounded-xl" style={{ background: "#fff", border: "1px solid var(--border)" }}>
          {loading ? (
            <div className="h-5 w-28 rounded animate-pulse" style={{ background: "#f3f4f6" }} />
          ) : (
            <span className="text-sm font-bold" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
              {formatEuro(fatturato)}
            </span>
          )}
        </div>

        {/* Contatore */}
        <div className="flex items-center px-4 py-2 rounded-xl" style={{ background: "#fff", border: "1px solid var(--border)" }}>
          {loading ? (
            <div className="h-5 w-8 rounded animate-pulse" style={{ background: "#f3f4f6" }} />
          ) : (
            <span className="text-sm font-bold" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
              {filtered.length}
            </span>
          )}
        </div>

        {/* Date range picker */}
        <div className="relative" ref={datePickerRef}>
          <button
            onClick={() => setShowDatePicker((v) => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-colors hover:bg-[#f9fafb]"
            style={{ background: "#fff", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "#374151" }}
          >
            <CalendarDays size={13} style={{ color: "#6b7280" }} />
            {dateRangeLabel}
          </button>

          <AnchoredPopover
            open={showDatePicker}
            onClose={() => setShowDatePicker(false)}
            anchorRef={datePickerRef}
            width={320}
            align="right"
          >
            <CalendarRangePicker
              dataDa={dataDa}
              dataA={dataA}
              onChange={(da, a) => { setDataDa(da); setDataA(a); setSearchEntries(null); }}
            />
          </AnchoredPopover>
        </div>

        {/* Reset — torna ad oggi */}
        {!isDefaultRange && (
          <button
            onClick={resetRange}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors hover:bg-[#f9fafb]"
            style={{ background: "#fff", border: "1px solid var(--border)", color: "#374151", fontFamily: "var(--font-montserrat)" }}
          >
            <RefreshCw size={13} />
            Reset
          </button>
        )}
      </div>

      {/* Table card */}
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)", background: "#fff" }}>

        {/* Barra azioni bulk */}
        {selectedIds.size > 0 && (
          <div
            className="flex items-center gap-2.5 px-4 py-2.5 flex-wrap"
            style={{ background: "#FFFDF0", borderBottom: "1px solid #FFC803" }}
          >
            <span className="text-xs font-bold mr-1" style={{ color: "#111", fontFamily: "var(--font-montserrat)" }}>
              {selectedIds.size} selezionat{selectedIds.size === 1 ? "o" : "i"}
            </span>
            <button
              onClick={handleExportSelected}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors hover:bg-[#f9fafb]"
              style={{ border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontFamily: "var(--font-montserrat)" }}
            >
              <Download size={12} /> Export CSV
            </button>
            <button
              onClick={() => handleSpedisci("Roma")}
              disabled={spedendo !== null || aggiornandoTracking}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors hover:bg-[#f9fafb] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontFamily: "var(--font-montserrat)" }}
            >
              <MapPin size={12} /> {spedendo === "Roma" ? "Spedizione Roma…" : "Spedisci Roma"}
            </button>
            <button
              onClick={() => handleSpedisci("Nola")}
              disabled={spedendo !== null || aggiornandoTracking}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors hover:bg-[#f9fafb] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontFamily: "var(--font-montserrat)" }}
            >
              <MapPin size={12} /> {spedendo === "Nola" ? "Spedizione Nola…" : "Spedisci Nola"}
            </button>
            <button
              onClick={handleAggiornaTracking}
              disabled={spedendo !== null || aggiornandoTracking}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors hover:bg-[#f9fafb] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontFamily: "var(--font-montserrat)" }}
            >
              <RefreshCw size={12} /> {aggiornandoTracking ? "Aggiornamento…" : "Aggiorna Tracking"}
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold ml-auto"
              style={{ background: "#fee2e2", color: "#ef4444", fontFamily: "var(--font-montserrat)" }}
            >
              <X size={11} /> Deseleziona
            </button>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-11 rounded-xl animate-pulse" style={{ background: "#f3f4f6" }} />
            ))}
          </div>
        ) : (
          <>
          {/* ── Tabella — desktop ── */}
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                  <th className="pl-4 pr-2 py-3 w-10">
                    <button
                      onClick={toggleSelectAll}
                      className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
                      style={{
                        background: allSelected ? "#FFC803" : someSelected ? "#FFF8DC" : "#fff",
                        border: `1.5px solid ${(allSelected || someSelected) ? "#FFC803" : "#d1d5db"}`,
                      }}
                    >
                      {allSelected && <Check size={13} style={{ color: "#111" }} />}
                      {someSelected && <div style={{ width: 8, height: 2, background: "#FFC803", borderRadius: 1 }} />}
                    </button>
                  </th>
                  {/* ID, Cliente — etichette pill grigie */}
                  {["ID", "Cliente"].map((h) => (
                    <th key={h} className="px-3 py-3 text-left whitespace-nowrap">
                      <span className="inline-block px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider"
                        style={{ background: "#eceef1", color: "#4b5563", fontFamily: "var(--font-montserrat)" }}>
                        {h}
                      </span>
                    </th>
                  ))}

                  {/* Fonte — filtro nell'intestazione (come Spedizioni) */}
                  <th className="px-3 py-3">
                    <HeaderFilter value={fonte} onChange={setFonte} title="Filtra per fonte">
                      <option value="">Fonte</option>
                      {FONTI.map((f) => <option key={f} value={f}>{f}</option>)}
                    </HeaderFilter>
                  </th>

                  {/* Data — etichetta pill grigia */}
                  <th className="px-3 py-3 text-left whitespace-nowrap">
                    <span className="inline-block px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider"
                      style={{ background: "#eceef1", color: "#4b5563", fontFamily: "var(--font-montserrat)" }}>
                      Data
                    </span>
                  </th>

                  {/* Stato — filtro nell'intestazione (come Spedizioni) */}
                  <th className="px-3 py-3">
                    <HeaderFilter value={stato} onChange={setStato} title="Filtra per stato">
                      <option value="">Stato</option>
                      {STATI_FILTRO.map((s) => <option key={s} value={s}>{s}</option>)}
                    </HeaderFilter>
                  </th>

                  {/* Sped, Totale — etichette pill grigie */}
                  {["Sped", "Totale"].map((h) => (
                    <th key={h} className="px-3 py-3 text-left whitespace-nowrap">
                      <span className="inline-block px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider"
                        style={{ background: "#eceef1", color: "#4b5563", fontFamily: "var(--font-montserrat)" }}>
                        {h}
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-3 w-10" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-14 text-center text-sm" style={{ color: "#9ca3af" }}>
                      Nessun ordine trovato.
                    </td>
                  </tr>
                ) : (
                  filtered.map(({ ordine, clienteNome, docId }) => {
                    const isSelected = selectedIds.has(docId);
                    return (
                      <tr
                        key={docId}
                        className="hover:bg-[#FFFDF0] transition-colors"
                        style={{ borderBottom: "1px solid #f3f4f6", background: isSelected ? "#FFFDF0" : undefined }}
                      >
                        <td className="pl-4 pr-2 py-3.5 w-10">
                          <button
                            onClick={() => toggleSelect(docId)}
                            className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
                            style={{
                              background: isSelected ? "#FFC803" : "#fff",
                              border: `1.5px solid ${isSelected ? "#FFC803" : "#d1d5db"}`,
                            }}
                          >
                            {isSelected && <Check size={13} style={{ color: "#111" }} />}
                          </button>
                        </td>

                        <td className="px-3 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: "#111" }}>
                          {ordine.id}
                        </td>

                        <td className="px-3 py-3 max-w-[160px] truncate text-xs" style={{ color: "#374151" }}>
                          {clienteNome}
                        </td>

                        <td className="px-3 py-3">
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap"
                            style={{
                              background: FONTE_COLORS[ordine.Source]?.bg ?? "#E8E8E8",
                              color: FONTE_COLORS[ordine.Source]?.text ?? "#374151",
                            }}
                          >
                            {ordine.Source}
                          </span>
                        </td>

                        <td className="px-3 py-3 text-xs whitespace-nowrap" style={{ color: "#6b7280" }}>
                          {formatData(getTs(ordine))}
                        </td>

                        <td className="px-3 py-3">
                          {(() => {
                            const cur = ordine.Stato as OrdineStato;
                            const style = STATO_PILL[cur] ?? { bg: "#F3F4F6", text: "#4B5563", border: "#D1D5DB" };
                            const isSaving = savingStato === docId;
                            const isReadOnly = STATI_READONLY.has(cur);
                            return (
                              <div className="relative inline-block">
                                <select
                                  value={cur}
                                  disabled={isSaving || isReadOnly}
                                  onChange={(e) => handleRowStatoChange(docId, e.target.value as OrdineStato, cur, ordine)}
                                  className="appearance-none pl-2.5 pr-7 py-1 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                                  style={{
                                    background: style.bg,
                                    color: style.text,
                                    border: `1px solid ${style.border}`,
                                    fontFamily: "var(--font-montserrat)",
                                    outline: "none",
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {/* Stato corrente sempre selezionabile (anche se read-only) */}
                                  {isReadOnly && <option value={cur}>{cur}</option>}
                                  {STATI.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <ChevronDown
                                  size={11}
                                  className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none"
                                  style={{ color: style.text }}
                                />
                              </div>
                            );
                          })()}
                        </td>

                        <td className="px-3 py-3">
                          <button
                            className="p-1.5 rounded-lg hover:bg-[#f3f4f6] transition-colors"
                            title="Spedizioni ordine"
                            onClick={() => setSpedizioneModal({ docId, orderId: ordine.id ?? docId })}
                          >
                            <Truck size={15} style={{ color: "#374151" }} />
                          </button>
                        </td>

                        <td className="px-3 py-3 text-xs font-bold whitespace-nowrap" style={{ color: "#111" }}>
                          {formatEuro(ordine.Totale)}
                        </td>

                        <td className="px-3 py-3">
                          <Link
                            href={`/admin/ordini/${docId}`}
                            className="p-1.5 rounded-lg hover:bg-[#FFF8DC] transition-colors inline-flex"
                            title="Dettagli ordine"
                          >
                            <Eye size={15} style={{ color: "#374151" }} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* ── Card — mobile ── */}
          <div className="md:hidden">
            {/* Seleziona tutti */}
            <div className="flex items-center gap-2.5 px-3 py-2.5" style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <button
                onClick={toggleSelectAll}
                className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                style={{
                  background: allSelected ? "#FFC803" : someSelected ? "#FFF8DC" : "#fff",
                  border: `1.5px solid ${(allSelected || someSelected) ? "#FFC803" : "#d1d5db"}`,
                }}
              >
                {allSelected && <Check size={13} style={{ color: "#111" }} />}
                {someSelected && <div style={{ width: 8, height: 2, background: "#FFC803", borderRadius: 1 }} />}
              </button>
              <span className="text-xs font-semibold" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
                Seleziona tutti
              </span>
            </div>

            {filtered.length === 0 ? (
              <div className="py-14 text-center text-sm" style={{ color: "#9ca3af" }}>Nessun ordine trovato.</div>
            ) : (
              filtered.map(({ ordine, clienteNome, docId }) => {
                const isSelected = selectedIds.has(docId);
                const cur = ordine.Stato as OrdineStato;
                const pill = STATO_PILL[cur] ?? { bg: "#F3F4F6", text: "#4B5563", border: "#D1D5DB" };
                const isSaving = savingStato === docId;
                const isReadOnly = STATI_READONLY.has(cur);
                const isOpen = expandedOrders.has(docId);
                return (
                  <div key={docId} className="p-3" style={{ borderBottom: "1px solid #f3f4f6", background: isSelected ? "#FFFDF0" : undefined }}>
                    {/* ID + Totale */}
                    <div className="flex items-center gap-2.5">
                      <button
                        onClick={() => toggleSelect(docId)}
                        className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                        style={{ background: isSelected ? "#FFC803" : "#fff", border: `1.5px solid ${isSelected ? "#FFC803" : "#d1d5db"}` }}
                      >
                        {isSelected && <Check size={13} style={{ color: "#111" }} />}
                      </button>
                      <span className="text-sm font-bold flex-1 min-w-0 truncate" style={{ color: "#111" }}>{ordine.id}</span>
                      <span className="text-sm font-bold flex-shrink-0" style={{ color: "#111" }}>{formatEuro(ordine.Totale)}</span>
                    </div>

                    {/* Cliente */}
                    <p className="text-xs mt-1.5 truncate" style={{ color: "#374151" }}>{clienteNome}</p>

                    {/* Stato + toggle tendina */}
                    <div className="flex items-center gap-2 mt-2.5">
                      <div className="relative flex-1">
                        <select
                          value={cur}
                          disabled={isSaving || isReadOnly}
                          onChange={(e) => handleRowStatoChange(docId, e.target.value as OrdineStato, cur, ordine)}
                          className="appearance-none w-full pl-2.5 pr-7 py-1.5 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                          style={{ background: pill.bg, color: pill.text, border: `1px solid ${pill.border}`, fontFamily: "var(--font-montserrat)", outline: "none" }}
                        >
                          {isReadOnly && <option value={cur}>{cur}</option>}
                          {STATI.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: pill.text }} />
                      </div>
                      <button
                        onClick={() => toggleOrderDetails(docId)}
                        aria-expanded={isOpen}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors hover:bg-gray-100 flex-shrink-0"
                        style={{ border: "1px solid #e5e7eb", color: "#374151", fontFamily: "var(--font-montserrat)" }}
                      >
                        {isOpen ? "Nascondi" : "Dettagli"}
                        <ChevronDown size={12} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                      </button>
                    </div>

                    {/* Tendina dettagli — info aggiuntive */}
                    {isOpen && (
                      <div className="mt-2 pt-2 flex flex-col gap-2.5" style={{ borderTop: "1px dashed #e5e7eb" }}>
                        {/* Fonte + Data */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>Fonte</span>
                          <span
                            className="px-2 py-0.5 rounded-full text-[11px] font-bold"
                            style={{ background: FONTE_COLORS[ordine.Source]?.bg ?? "#E8E8E8", color: FONTE_COLORS[ordine.Source]?.text ?? "#374151" }}
                          >
                            {ordine.Source}
                          </span>
                          <span className="text-[10px] font-semibold uppercase tracking-wider ml-1" style={{ color: "#9ca3af", fontFamily: "var(--font-montserrat)" }}>Data</span>
                          <span className="text-xs" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>{formatData(getTs(ordine))}</span>
                        </div>
                        {/* Azioni */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => setSpedizioneModal({ docId, orderId: ordine.id ?? docId })}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-[#f3f4f6]"
                            style={{ border: "1px solid #e5e7eb", color: "#374151", fontFamily: "var(--font-montserrat)" }}
                          >
                            <Truck size={14} /> Spedizioni
                          </button>
                          <Link
                            href={`/admin/ordini/${docId}`}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-[#FFF8DC]"
                            style={{ border: "1px solid #e5e7eb", color: "#374151", fontFamily: "var(--font-montserrat)" }}
                          >
                            <Eye size={14} /> Dettagli ordine
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          </>
        )}
      </div>

      {spedizioneModal && (
        <SpedizioneModal
          docId={spedizioneModal.docId}
          orderId={spedizioneModal.orderId}
          onClose={() => setSpedizioneModal(null)}
        />
      )}

      {/* Modal annulla ordine — mirror FF MotivoAnnullamentoWidget */}
      {annullaModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget && !annullando) setAnnullaModal(null); }}
        >
          <div
            className="w-full max-w-md rounded-2xl p-6"
            style={{ background: "#fff", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-base" style={{ fontFamily: "var(--font-poppins)", color: "#111" }}>
                  Annulla ordine
                </h3>
                <p className="text-xs mt-0.5" style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}>
                  {annullaModal.orderId}
                </p>
              </div>
              <button
                onClick={() => { if (!annullando) setAnnullaModal(null); }}
                className="p-1 rounded-lg hover:bg-[#F1F4F8] disabled:opacity-40"
                disabled={annullando}
              >
                <X size={18} style={{ color: "#6b7280" }} />
              </button>
            </div>

            <label
              className="text-xs font-semibold mb-1 block"
              style={{ color: "#6b7280", fontFamily: "var(--font-montserrat)" }}
            >
              Motivo
            </label>
            <textarea
              value={motivoAnnulla}
              onChange={(e) => setMotivoAnnulla(e.target.value)}
              rows={4}
              autoFocus
              placeholder="Scrivi motivo dell'annullamento"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
              style={{
                background: "#F8F8F8",
                border: "1px solid #e5e7eb",
                fontFamily: "var(--font-montserrat)",
                color: "#111",
              }}
            />

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setAnnullaModal(null)}
                disabled={annullando}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#F1F4F8] disabled:opacity-40"
                style={{ border: "1px solid #e5e7eb", color: "#111", fontFamily: "var(--font-montserrat)", background: "#fff" }}
              >
                Indietro
              </button>
              <button
                onClick={handleConfermaAnnulla}
                disabled={annullando || !motivoAnnulla.trim()}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                style={{ background: "#DC2626", color: "#fff", fontFamily: "var(--font-montserrat)" }}
              >
                {annullando ? "Annullamento…" : "Conferma"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
