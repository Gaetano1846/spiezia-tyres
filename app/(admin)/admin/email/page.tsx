"use client";

import { useState, useEffect, useMemo } from "react";
import {
  collection, query, orderBy, getDocs, getDoc,
  updateDoc, doc, limit, type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Mail, Send, X, Search, Sparkles, Loader2 } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import toast from "react-hot-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type EmailFS = {
  id: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  html?: string;
  receivedAt?: Timestamp;
  tipologia?: string;       // "ebay" | "tyre24"
  direzione?: string;       // "ricevuta" | "inviata"
  letta?: boolean;
  seen?: boolean;
  Risposto?: boolean;
  Risposta_suggerita?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function iniziali(from?: string): string {
  if (!from) return "?";
  const parts = from.replace(/<.*>/, "").trim().split(" ");
  return parts.map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
}

function formatData(ts?: Timestamp): string {
  if (!ts?.toDate) return "";
  const d   = ts.toDate();
  const dd  = String(d.getDate()).padStart(2, "0");
  const mm  = String(d.getMonth() + 1).padStart(2, "0");
  const hh  = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${min}`;
}

const TIPOLOGIA_VARIANT: Record<string, "brand" | "neutral" | "success"> = {
  ebay:   "brand",
  tyre24: "success",
};

// ── Skeleton ──────────────────────────────────────────────────────────────────

function ListSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 py-3 px-1 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="w-9 h-9 rounded-full animate-pulse flex-shrink-0" style={{ background: "var(--border)" }} />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 rounded animate-pulse w-1/2" style={{ background: "var(--border)" }} />
            <div className="h-2.5 rounded animate-pulse w-3/4" style={{ background: "var(--border)" }} />
            <div className="h-2.5 rounded animate-pulse w-full" style={{ background: "var(--border)" }} />
          </div>
        </div>
      ))}
    </>
  );
}

// ── Chip component ────────────────────────────────────────────────────────────

function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className="px-2.5 py-1 rounded-full text-xs font-semibold transition-colors"
          style={{
            fontFamily: "var(--font-montserrat)",
            background: value === o.key ? "var(--brand)" : "var(--bg-primary)",
            color: value === o.key ? "#111" : "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type TabDir    = "ricevute" | "inviate";
type TabRisp   = "tutte" | "non-risposte" | "risposte";
type TabTipo   = "tutte" | "ebay" | "tyre24";

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EmailPage() {
  const [emails,    setEmails]    = useState<EmailFS[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [selected,  setSelected]  = useState<EmailFS | null>(null);
  const [risposta,  setRisposta]  = useState("");
  const [search,    setSearch]    = useState("");
  const [sending,   setSending]   = useState(false);
  const [generando, setGenerando] = useState(false);

  // Filtri (come Flutter: direzione, risposto, tipologia)
  const [tabDir,  setTabDir]  = useState<TabDir>("ricevute");
  const [tabRisp, setTabRisp] = useState<TabRisp>("tutte");
  const [tabTipo, setTabTipo] = useState<TabTipo>("tutte");

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDocs(
          query(collection(db, "Emails"), orderBy("receivedAt", "desc"), limit(200))
        );
        setEmails(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EmailFS, "id">) })));
      } catch (err) {
        console.error(err);
        toast.error("Errore nel caricamento delle email");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSelect(e: EmailFS) {
    setSelected(e);
    setRisposta(e.Risposta_suggerita ?? "");
    if (e.letta && e.seen) return;
    setEmails((prev) => prev.map((em) => em.id === e.id ? { ...em, letta: true, seen: true } : em));
    try {
      await updateDoc(doc(db, "Emails", e.id), { letta: true, seen: true });
    } catch {
      setEmails((prev) => prev.map((em) => em.id === e.id ? { ...em, letta: false } : em));
    }
  }

  async function handleGeneraAI() {
    if (!selected) return;
    setGenerando(true);
    const emailId = selected.id;
    try {
      const res = await fetch("/api/email-admin/ai-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId }),
      });
      if (!res.ok) throw new Error("Errore generazione AI");

      // La route aggiorna Risposta_suggerita direttamente su Firestore.
      // Ri-leggiamo il doc per ottenere il testo generato.
      const snap = await getDoc(doc(db, "Emails", emailId));
      const reply = snap.exists() ? ((snap.data()?.Risposta_suggerita as string) ?? "") : "";

      setRisposta(reply);
      setSelected((prev) => prev ? { ...prev, Risposta_suggerita: reply } : prev);
      setEmails((prev) =>
        prev.map((em) => em.id === emailId ? { ...em, Risposta_suggerita: reply } : em)
      );
      if (reply) toast.success("Risposta AI generata");
      else toast.error("Nessun testo generato dalla CF");
    } catch {
      toast.error("Errore nella generazione AI");
    } finally {
      setGenerando(false);
    }
  }

  async function handleSend() {
    if (!selected || !risposta.trim()) return;
    setSending(true);
    const emailId = selected.id;
    try {
      const res = await fetch("/api/email-admin/send-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to:               selected.from ?? "",
          subject:          `RE: ${selected.subject ?? ""}`,
          htmlBody:         risposta.trim(),
          replyToMessageId: emailId,
        }),
      });
      if (!res.ok) throw new Error("Errore invio");
      // Aggiorna Firestore dopo invio
      await updateDoc(doc(db, "Emails", emailId), {
        Risposto:  true,
        letta:     true,
        seen:      true,
      });
      setEmails((prev) =>
        prev.map((em) => em.id === emailId ? { ...em, Risposto: true, letta: true } : em)
      );
      setSelected(null);
      setRisposta("");
      toast.success("Risposta inviata");
    } catch {
      toast.error("Errore nell'invio della risposta");
    } finally {
      setSending(false);
    }
  }

  // ── Filtri (come Flutter: direzione + risposto + tipologia) ──────────────────

  const lista = useMemo(() => {
    let arr = emails;

    // 1. Direzione
    if (tabDir === "ricevute") arr = arr.filter((e) => e.direzione !== "inviata");
    else arr = arr.filter((e) => e.direzione === "inviata");

    // 2. Stato risposta
    if (tabRisp === "risposte")     arr = arr.filter((e) => e.Risposto === true);
    if (tabRisp === "non-risposte") arr = arr.filter((e) => !e.Risposto);

    // 3. Tipologia
    if (tabTipo !== "tutte") arr = arr.filter((e) => e.tipologia === tabTipo);

    // 4. Ricerca
    if (search) {
      const q = search.toLowerCase();
      arr = arr.filter((e) => [e.from, e.subject, e.body].join(" ").toLowerCase().includes(q));
    }

    return arr;
  }, [emails, tabDir, tabRisp, tabTipo, search]);

  const nonLette = useMemo(
    () => emails.filter((e) => e.direzione !== "inviata" && !e.letta && !e.seen),
    [emails]
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-poppins)" }}>Email</h1>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
          {loading ? "Caricamento…" : `${nonLette.length} non lette`}
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-3 md:h-[calc(100vh-200px)]" style={{ minHeight: 520 }}>
        {/* ── Left panel — list ── */}
        <Card
          padding="sm"
          className={`flex flex-col overflow-hidden w-full flex-shrink-0 ${selected ? "md:w-[38%]" : ""}`}
          style={{ minWidth: 0 }}
        >
          {/* Filtro direzione */}
          <div className="mb-2 flex-shrink-0">
            <Chips<TabDir>
              options={[
                { key: "ricevute", label: "Ricevute" },
                { key: "inviate",  label: "Inviate" },
              ]}
              value={tabDir}
              onChange={(v) => { setTabDir(v); setSelected(null); }}
            />
          </div>

          {/* Filtro risposto */}
          <div className="mb-2 flex-shrink-0">
            <Chips<TabRisp>
              options={[
                { key: "tutte",         label: "Tutte" },
                { key: "non-risposte",  label: "Non risposte" },
                { key: "risposte",      label: "Risposte" },
              ]}
              value={tabRisp}
              onChange={(v) => { setTabRisp(v); setSelected(null); }}
            />
          </div>

          {/* Filtro tipologia */}
          <div className="mb-3 flex-shrink-0">
            <Chips<TabTipo>
              options={[
                { key: "tutte",  label: "Tutte" },
                { key: "ebay",   label: "eBay" },
                { key: "tyre24", label: "Tyre24" },
              ]}
              value={tabTipo}
              onChange={(v) => { setTabTipo(v); setSelected(null); }}
            />
          </div>

          {/* Search */}
          <div className="relative mb-2 flex-shrink-0">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per mittente, oggetto, testo…"
              className="w-full pl-9 pr-4 py-2 rounded-xl text-sm outline-none"
              style={{
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                fontFamily: "var(--font-montserrat)",
              }}
            />
          </div>

          {/* Conteggio filtrato */}
          <p className="text-[10px] mb-1 flex-shrink-0" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
            {loading ? "" : `${lista.length} email`}
          </p>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <ListSkeleton />
            ) : lista.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 py-12">
                <Mail size={32} style={{ color: "#d1d5db" }} />
                <p className="text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  Nessuna email trovata.
                </p>
              </div>
            ) : (
              lista.map((e) => {
                const isUnread   = !e.letta && !e.seen && e.direzione !== "inviata";
                const isSelected = selected?.id === e.id;
                return (
                  <div
                    key={e.id}
                    onClick={() => handleSelect(e)}
                    className="cursor-pointer"
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <div
                      className="flex items-start gap-2.5 py-3 px-1 rounded-xl transition-colors hover:bg-[#FFFDF0]"
                      style={{ background: isSelected ? "#FFF8DC" : "transparent" }}
                    >
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ background: "#FFC803", color: "#111" }}
                      >
                        {iniziali(e.from)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p
                            className="text-xs truncate"
                            style={{
                              fontFamily: "var(--font-montserrat)",
                              fontWeight: isUnread ? 700 : 500,
                              color: "var(--text-primary)",
                            }}
                          >
                            {e.from ?? "—"}
                          </p>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {isUnread && (
                              <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--brand)" }} />
                            )}
                            {e.Risposto && (
                              <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#22C55E" }} />
                            )}
                            <span className="text-[10px]" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                              {formatData(e.receivedAt)}
                            </span>
                          </div>
                        </div>
                        <p
                          className="text-xs font-semibold mt-0.5 truncate"
                          style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}
                        >
                          {e.subject ?? "—"}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <p
                            className="text-[10px] truncate flex-1"
                            style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
                          >
                            {e.body ?? ""}
                          </p>
                          {e.tipologia && (
                            <Badge variant={TIPOLOGIA_VARIANT[e.tipologia] ?? "neutral"} className="flex-shrink-0">
                              {e.tipologia}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* ── Right panel — detail + reply ── */}
        {selected && (
          <Card padding="sm" className="flex flex-col flex-1 min-w-0 overflow-hidden md:max-h-[calc(100vh-200px)]">
            {/* Header */}
            <div className="flex items-start justify-between mb-3 flex-shrink-0">
              <div className="flex-1 min-w-0 pr-2">
                <h2
                  className="font-bold text-sm leading-tight"
                  style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}
                >
                  {selected.subject ?? ""}
                </h2>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  Da: <span style={{ color: "var(--text-secondary)" }}>{selected.from ?? "—"}</span>
                  {selected.to && (
                    <> · A: <span style={{ color: "var(--text-secondary)" }}>{selected.to}</span></>
                  )}
                  {selected.receivedAt && ` · ${formatData(selected.receivedAt)}`}
                </p>
                {selected.tipologia && (
                  <div className="mt-1">
                    <Badge variant={TIPOLOGIA_VARIANT[selected.tipologia] ?? "neutral"}>
                      {selected.tipologia}
                    </Badge>
                  </div>
                )}
              </div>
              <button
                onClick={() => setSelected(null)}
                className="p-1.5 rounded-xl flex-shrink-0"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
              >
                <X size={14} style={{ color: "var(--text-muted)" }} />
              </button>
            </div>

            {/* Body */}
            <div
              className="flex-1 rounded-xl p-3 mb-3 text-sm leading-relaxed overflow-y-auto"
              style={{
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                fontFamily: "var(--font-montserrat)",
                color: "var(--text-primary)",
              }}
            >
              {selected.html ? (
                <div dangerouslySetInnerHTML={{ __html: selected.html }} />
              ) : (
                <pre className="whitespace-pre-wrap text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                  {selected.body ?? ""}
                </pre>
              )}
            </div>

            {/* Risposta suggerita (se già generata, mostrala separata come Flutter) */}
            {selected.Risposta_suggerita && (
              <div
                className="rounded-xl p-3 mb-2 flex-shrink-0"
                style={{ background: "#F0FDF4", border: "1px solid #BBF7D0" }}
              >
                <p
                  className="text-[10px] font-bold uppercase tracking-widest mb-1"
                  style={{ color: "#065F46", fontFamily: "var(--font-montserrat)" }}
                >
                  Risposta suggerita dall&apos;AI
                </p>
                <p className="text-xs" style={{ color: "#065F46", fontFamily: "var(--font-montserrat)" }}>
                  {selected.Risposta_suggerita}
                </p>
              </div>
            )}

            {/* Reply area — solo per email ricevute */}
            {selected.direzione !== "inviata" && (
              <div className="flex-shrink-0 space-y-2">
                <div className="flex items-center justify-between">
                  <p
                    className="text-[10px] font-bold uppercase tracking-widest"
                    style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
                  >
                    Risposta rapida
                  </p>
                  <button
                    onClick={handleGeneraAI}
                    disabled={generando}
                    className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                    style={{
                      background: "#f9fafb",
                      border: "1px solid var(--border)",
                      fontFamily: "var(--font-montserrat)",
                    }}
                  >
                    {generando ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                    Genera AI
                  </button>
                </div>

                <textarea
                  rows={4}
                  value={risposta}
                  onChange={(e) => setRisposta(e.target.value)}
                  placeholder="Scrivi una risposta…"
                  className="w-full rounded-xl p-3 text-sm outline-none resize-none"
                  style={{
                    background: "var(--bg-primary)",
                    border: "1px solid var(--border)",
                    fontFamily: "var(--font-montserrat)",
                    color: "var(--text-primary)",
                  }}
                />

                <button
                  onClick={handleSend}
                  disabled={sending || !risposta.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-50 hover:opacity-80 transition-all hover:brightness-[1.04] active:scale-[.98] disabled:active:scale-100"
                  style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}
                >
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {sending ? "Invio…" : "Invia risposta"}
                </button>
              </div>
            )}

            {/* Email inviata — mostra corpo */}
            {selected.direzione === "inviata" && (
              <div
                className="rounded-xl p-3 flex-shrink-0 text-sm"
                style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", fontFamily: "var(--font-montserrat)", color: "#065F46" }}
              >
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1">Email inviata</p>
                {selected.body ?? ""}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
