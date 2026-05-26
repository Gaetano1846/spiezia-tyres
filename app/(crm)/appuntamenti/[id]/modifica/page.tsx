"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  collection, getDocs, updateDoc, getDoc, orderBy, query,
  Timestamp, doc, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ArrowLeft, Search, Plus, X } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";
import type { Cliente, Veicolo, Sede, Appuntamento } from "@/lib/types";

type OperatoreItem = { id: string; displayName?: string; email?: string; Nome?: string; Cognome?: string };
type PneumaticoRow = { Marca: string; Misura: string; Stagione: string; Quantita: number };

function nomeOperatore(o: OperatoreItem): string {
  if (o.Nome || o.Cognome) return `${o.Nome ?? ""} ${o.Cognome ?? ""}`.trim();
  return o.displayName || o.email || o.id;
}
const emptyPneumatico = (): PneumaticoRow => ({ Marca: "", Misura: "", Stagione: "Estive", Quantita: 4 });

function nomeCliente(c: Cliente): string {
  if (c.Azienda && c.Ragione_Sociale) return c.Ragione_Sociale;
  return c.Nome?.trim() || c.Ragione_Sociale || "—";
}

export default function ModificaAppuntamentoPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [sedi, setSedi] = useState<Sede[]>([]);
  const [clienti, setClienti] = useState<Cliente[]>([]);
  const [operatori, setOperatori] = useState<OperatoreItem[]>([]);
  const [clienteSearch, setClienteSearch] = useState("");
  const [clienteSelezionato, setClienteSelezionato] = useState<Cliente | null>(null);
  const [veicoliCliente, setVeicoliCliente] = useState<Veicolo[]>([]);

  const [data, setData] = useState("");
  const [ora, setOra] = useState("");
  const [sedeId, setSedeId] = useState("");
  const [veicoloId, setVeicoloId] = useState("");
  const [servizio, setServizio] = useState("");
  const [operatoreId, setOperatoreId] = useState("");
  const [pneumatici, setPneumatici] = useState<PneumaticoRow[]>([]);
  const [note, setNote] = useState("");
  const [stato, setStato] = useState("Programmato");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      const [appSnap, sediSnap, clientiSnap, usersSnap] = await Promise.all([
        getDoc(doc(db, "Appuntamenti", id)),
        getDocs(collection(db, "Sede")),
        getDocs(query(collection(db, "Clienti"), orderBy("Nome"))),
        getDocs(query(collection(db, "users"), orderBy("Nome"))),
      ]);

      if (!appSnap.exists()) {
        toast.error("Appuntamento non trovato");
        router.push("/appuntamenti");
        return;
      }

      const app = { id: appSnap.id, ...appSnap.data() } as Appuntamento;
      const allSedi = sediSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Sede));
      const allClienti = clientiSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Cliente));
      const allOps = usersSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as OperatoreItem & { CRM?: boolean }))
        .filter((u) => u.CRM === true);

      setSedi(allSedi);
      setClienti(allClienti);
      setOperatori(allOps);

      // Pre-popola stato
      setStato(app.Stato ?? "Programmato");
      if (app.Note) setNote(app.Note as string);

      // DataOra → data e ora string
      const ts = app.DataOra as Timestamp;
      if (ts?.toDate) {
        const d = ts.toDate();
        setData(d.toISOString().slice(0, 10));
        setOra(d.toTimeString().slice(0, 5));
      }

      // Sede
      const sedeRef = app.Sede as { id?: string; path?: string } | null | undefined;
      if (sedeRef) {
        const sid = sedeRef.id ?? sedeRef.path?.split("/").pop() ?? "";
        setSedeId(sid);
      }

      // Servizio
      const servizi = app.Servizi as Array<{ Titolo?: string }> | undefined;
      if (servizi?.[0]?.Titolo) setServizio(servizi[0].Titolo);

      // Operatore
      const operatoreRef = app.Operatore as { id?: string; path?: string } | null | undefined;
      if (operatoreRef) {
        const oid = operatoreRef.id ?? operatoreRef.path?.split("/").pop() ?? "";
        if (oid) setOperatoreId(oid);
      }

      // Pneumatici
      const pneumRaw = (app as Record<string, unknown>).Pneumatici as PneumaticoRow[] | undefined;
      if (Array.isArray(pneumRaw) && pneumRaw.length > 0) {
        setPneumatici(pneumRaw.map((p) => ({
          Marca: p.Marca ?? "",
          Misura: p.Misura ?? "",
          Stagione: p.Stagione ?? "Estive",
          Quantita: p.Quantita ?? 4,
        })));
      }

      // Cliente
      const clienteRef = app.Cliente as { id?: string; path?: string } | null | undefined;
      if (clienteRef) {
        const cid = clienteRef.id ?? clienteRef.path?.split("/").pop() ?? "";
        const found = allClienti.find((c) => c.id === cid);
        if (found) {
          setClienteSelezionato(found);
          const vSnap = await getDocs(collection(db, "Clienti", cid, "Veicolo"));
          const veicoli = vSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Veicolo));
          setVeicoliCliente(veicoli);

          const veicoloRef = app.Veicolo as { id?: string; path?: string } | null | undefined;
          if (veicoloRef) {
            const vid = veicoloRef.id ?? veicoloRef.path?.split("/").pop() ?? "";
            setVeicoloId(vid);
          }
        }
      }

      setLoading(false);
    };

    fetchAll().catch((err) => {
      console.error(err);
      toast.error("Errore nel caricamento");
      setLoading(false);
    });
  }, [id, router]);

  function addPneumatico() { setPneumatici((p) => [...p, emptyPneumatico()]); }
  function removePneumatico(idx: number) { setPneumatici((p) => p.filter((_, i) => i !== idx)); }
  function updatePneumatico(idx: number, field: keyof PneumaticoRow, value: string | number) {
    setPneumatici((p) => p.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  const clientiFiltrati = clienti
    .filter((c) => {
      const nome = nomeCliente(c);
      return (
        nome.toLowerCase().includes(clienteSearch.toLowerCase()) ||
        (c.Email ?? "").toLowerCase().includes(clienteSearch.toLowerCase()) ||
        (c.Telefono ?? "").includes(clienteSearch)
      );
    })
    .slice(0, 8);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteSelezionato || !data || !ora || !sedeId) {
      toast.error("Compila i campi obbligatori (cliente, data, ora, sede)");
      return;
    }
    setSaving(true);
    try {
      const [year, month, day] = data.split("-").map(Number);
      const [hours, minutes] = ora.split(":").map(Number);
      const dataOra = new Date(year, month - 1, day, hours, minutes);

      const payload: Record<string, unknown> = {
        Cliente: doc(db, "Clienti", clienteSelezionato.id),
        Sede: doc(db, "Sede", sedeId),
        DataOra: Timestamp.fromDate(dataOra),
        Stato: stato,
        DataModifica: serverTimestamp(),
      };
      if (veicoloId) {
        payload.Veicolo = doc(db, "Clienti", clienteSelezionato.id, "Veicolo", veicoloId);
      }
      payload.Servizi = servizio.trim()
        ? [{ Titolo: servizio.trim(), Prezzo: 0, Quantita: 1 }]
        : [];
      payload.Note = note.trim() || null;
      payload.Operatore = operatoreId ? doc(db, "users", operatoreId) : null;
      const pneumaticiValidi = pneumatici.filter((p) => p.Marca.trim() && p.Misura.trim());
      payload.Pneumatici = pneumaticiValidi.length > 0 ? pneumaticiValidi : null;

      await updateDoc(doc(db, "Appuntamenti", id), payload);
      toast.success("Appuntamento aggiornato");
      router.push("/appuntamenti");
    } catch (err) {
      console.error(err);
      toast.error("Errore nell'aggiornamento");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div className="h-8 w-48 rounded-xl animate-pulse" style={{ background: "var(--bg-primary)" }} />
        <div className="h-64 rounded-2xl animate-pulse" style={{ background: "var(--bg-primary)" }} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link
          href="/appuntamenti"
          className="p-2 rounded-xl transition-colors hover:bg-[#F1F4F8]"
          style={{ border: "1px solid var(--border)" }}
        >
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
          Modifica appuntamento
        </h1>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <div className="space-y-5">
            {/* Cliente */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                Cliente <span style={{ color: "#EF4444" }}>*</span>
              </label>
              {clienteSelezionato ? (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ border: "1px solid var(--brand)", background: "var(--bg-primary)" }}>
                  <span className="flex-1 text-sm font-semibold" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                    {nomeCliente(clienteSelezionato)}
                    {clienteSelezionato.Telefono && (
                      <span className="ml-2 font-normal text-xs" style={{ color: "var(--text-muted)" }}>{clienteSelezionato.Telefono}</span>
                    )}
                  </span>
                  <button type="button" onClick={() => { setClienteSelezionato(null); setClienteSearch(""); }}
                    className="text-xs px-2 py-1 rounded-lg"
                    style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)", border: "1px solid var(--border)" }}>
                    Cambia
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
                  <input type="text" value={clienteSearch} onChange={(e) => setClienteSearch(e.target.value)}
                    placeholder="Cerca per nome, email, telefono…"
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }} />
                  {clienteSearch.length >= 1 && (
                    <div className="absolute z-10 w-full mt-1 rounded-xl shadow-lg overflow-hidden"
                      style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                      {clientiFiltrati.length === 0 ? (
                        <div className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>Nessun cliente trovato</div>
                      ) : (
                        clientiFiltrati.map((c) => (
                          <button key={c.id} type="button"
                            onClick={async () => {
                              setClienteSelezionato(c);
                              setClienteSearch("");
                              setVeicoloId("");
                              const vSnap = await getDocs(collection(db, "Clienti", c.id, "Veicolo"));
                              setVeicoliCliente(vSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Veicolo)));
                            }}
                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-[#F1F4F8] transition-colors"
                            style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                            {nomeCliente(c)}
                            {c.Telefono && <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>{c.Telefono}</span>}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Data e Ora */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                  Data <span style={{ color: "#EF4444" }}>*</span>
                </label>
                <input type="date" value={data} onChange={(e) => setData(e.target.value)} required
                  className="w-full px-4 py-2.5 rounded-xl text-sm"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                  Ora <span style={{ color: "#EF4444" }}>*</span>
                </label>
                <input type="time" value={ora} onChange={(e) => setOra(e.target.value)} required
                  className="w-full px-4 py-2.5 rounded-xl text-sm"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }} />
              </div>
            </div>

            {/* Sede */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                Sede <span style={{ color: "#EF4444" }}>*</span>
              </label>
              <select value={sedeId} onChange={(e) => setSedeId(e.target.value)} required
                className="w-full px-4 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: sedeId ? "var(--text-primary)" : "var(--text-muted)", outline: "none" }}>
                <option value="">Seleziona sede…</option>
                {sedi.map((s) => <option key={s.id} value={s.id}>{s.Nome}</option>)}
              </select>
            </div>

            {/* Stato */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                Stato
              </label>
              <select value={stato} onChange={(e) => setStato(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}>
                <option value="Programmato">Programmato</option>
                <option value="In corso">In corso</option>
                <option value="Completato">Completato</option>
                <option value="Annullato">Annullato</option>
              </select>
            </div>

            {/* Operatore */}
            {operatori.length > 0 && (
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>Operatore</label>
                <select value={operatoreId} onChange={(e) => setOperatoreId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: operatoreId ? "var(--text-primary)" : "var(--text-muted)", outline: "none" }}>
                  <option value="">— Nessun operatore —</option>
                  {operatori.map((o) => <option key={o.id} value={o.id}>{nomeOperatore(o)}</option>)}
                </select>
              </div>
            )}

            {/* Veicolo */}
            {clienteSelezionato && veicoliCliente.length > 0 && (
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>Veicolo</label>
                <select value={veicoloId} onChange={(e) => setVeicoloId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}>
                  <option value="">Nessun veicolo</option>
                  {veicoliCliente.map((v) => (
                    <option key={v.id} value={v.id}>{v.Marca} {v.Modello}{v.Targa ? ` — ${v.Targa}` : ""}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Intervento */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>Tipo intervento</label>
              <input type="text" value={servizio} onChange={(e) => setServizio(e.target.value)}
                placeholder="Es. Cambio pneumatici, Revisione…"
                className="w-full px-4 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }} />
            </div>

            {/* Pneumatici */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>Pneumatici</label>
                <button type="button" onClick={addPneumatico}
                  className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg"
                  style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}>
                  <Plus size={12} /> Aggiungi
                </button>
              </div>
              {pneumatici.length === 0 ? (
                <p className="text-xs px-3 py-2 rounded-lg" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)", border: "1px dashed var(--border)" }}>
                  Nessun pneumatico aggiunto
                </p>
              ) : (
                <div className="space-y-2">
                  {pneumatici.map((p, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-4">
                        <input type="text" value={p.Marca} onChange={(e) => updatePneumatico(idx, "Marca", e.target.value)}
                          placeholder="Marca" className="w-full px-3 py-2 rounded-lg text-xs"
                          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }} />
                      </div>
                      <div className="col-span-3">
                        <input type="text" value={p.Misura} onChange={(e) => updatePneumatico(idx, "Misura", e.target.value)}
                          placeholder="205/55R16" className="w-full px-3 py-2 rounded-lg text-xs"
                          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }} />
                      </div>
                      <div className="col-span-3">
                        <select value={p.Stagione} onChange={(e) => updatePneumatico(idx, "Stagione", e.target.value)}
                          className="w-full px-2 py-2 rounded-lg text-xs"
                          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}>
                          <option value="Estive">Estive</option>
                          <option value="Invernali">Invernali</option>
                          <option value="4 Stagioni">4 Stagioni</option>
                        </select>
                      </div>
                      <div className="col-span-1">
                        <input type="number" value={p.Quantita} min={1} max={20}
                          onChange={(e) => updatePneumatico(idx, "Quantita", Number(e.target.value))}
                          className="w-full px-2 py-2 rounded-lg text-xs text-center"
                          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }} />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <button type="button" onClick={() => removePneumatico(idx)}
                          className="p-1 rounded-lg hover:bg-red-50 transition-colors">
                          <X size={14} style={{ color: "#EF4444" }} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Note */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>Note</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note aggiuntive…" rows={3}
                className="w-full px-4 py-2.5 rounded-xl text-sm resize-none"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }} />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-5" style={{ borderTop: "1px solid var(--border)" }}>
            <Link href="/appuntamenti"
              className="px-5 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
              Annulla
            </Link>
            <button type="submit" disabled={saving}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}>
              {saving ? "Salvataggio…" : "Salva modifiche"}
            </button>
          </div>
        </Card>
      </form>
    </div>
  );
}
