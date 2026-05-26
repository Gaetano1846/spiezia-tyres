"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  collection, query, getDocs, addDoc, orderBy,
  Timestamp, doc, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ArrowLeft, Search, Plus, X } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";
import type { Cliente, Veicolo, Sede } from "@/lib/types";

type OperatoreItem = { id: string; displayName?: string; email?: string; Nome?: string; Cognome?: string };
type PneumaticoRow = { Marca: string; Misura: string; Stagione: string; Quantita: number };

function nomeCliente(c: Cliente): string {
  if (c.Azienda && c.Ragione_Sociale) return c.Ragione_Sociale;
  return c.Nome?.trim() || c.Ragione_Sociale || "—";
}

function nomeOperatore(o: OperatoreItem): string {
  if (o.Nome || o.Cognome) return `${o.Nome ?? ""} ${o.Cognome ?? ""}`.trim();
  return o.displayName || o.email || o.id;
}

const emptyPneumatico = (): PneumaticoRow => ({ Marca: "", Misura: "", Stagione: "Estive", Quantita: 4 });

export default function NuovoAppuntamentoPage() {
  const router = useRouter();

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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      getDocs(collection(db, "Sede")),
      getDocs(query(collection(db, "Clienti"), orderBy("Nome"))),
      getDocs(query(collection(db, "users"), orderBy("Nome"))),
    ]).then(([sediSnap, clientiSnap, usersSnap]) => {
      setSedi(sediSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Sede)));
      setClienti(clientiSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Cliente)));
      const ops = usersSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as OperatoreItem & { CRM?: boolean }))
        .filter((u) => u.CRM === true);
      setOperatori(ops);
    });
  }, []);

  useEffect(() => {
    if (!clienteSelezionato) {
      setVeicoliCliente([]);
      setVeicoloId("");
      return;
    }
    getDocs(collection(db, "Clienti", clienteSelezionato.id, "Veicolo")).then((snap) => {
      setVeicoliCliente(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Veicolo)));
    });
  }, [clienteSelezionato]);

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

  function addPneumatico() {
    setPneumatici((prev) => [...prev, emptyPneumatico()]);
  }

  function removePneumatico(idx: number) {
    setPneumatici((prev) => prev.filter((_, i) => i !== idx));
  }

  function updatePneumatico(idx: number, field: keyof PneumaticoRow, value: string | number) {
    setPneumatici((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }

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
        Stato: "Programmato",
        DataCreazione: serverTimestamp(),
      };
      if (veicoloId) {
        payload.Veicolo = doc(db, "Clienti", clienteSelezionato.id, "Veicolo", veicoloId);
      }
      if (operatoreId) {
        payload.Operatore = doc(db, "users", operatoreId);
      }
      if (servizio.trim()) {
        payload.Servizi = [{ Titolo: servizio.trim(), Prezzo: 0, Quantita: 1 }];
      }
      const pneumaticiValidi = pneumatici.filter((p) => p.Marca.trim() && p.Misura.trim());
      if (pneumaticiValidi.length > 0) {
        payload.Pneumatici = pneumaticiValidi;
      }
      if (note.trim()) {
        payload.Note = note.trim();
      }

      await addDoc(collection(db, "Appuntamenti"), payload);
      toast.success("Appuntamento creato");
      router.push("/appuntamenti");
    } catch (err) {
      console.error(err);
      toast.error("Errore nella creazione dell'appuntamento");
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    fontFamily: "var(--font-montserrat)",
    color: "var(--text-primary)",
    outline: "none",
  };

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
        <h1
          className="text-2xl font-bold"
          style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}
        >
          Nuovo appuntamento
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
                      <span className="ml-2 font-normal text-xs" style={{ color: "var(--text-muted)" }}>
                        {clienteSelezionato.Telefono}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setClienteSelezionato(null); setClienteSearch(""); }}
                    className="text-xs px-2 py-1 rounded-lg"
                    style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)", border: "1px solid var(--border)" }}
                  >
                    Cambia
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
                  <input
                    type="text"
                    value={clienteSearch}
                    onChange={(e) => setClienteSearch(e.target.value)}
                    placeholder="Cerca per nome, email, telefono…"
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm"
                    style={inputStyle}
                  />
                  {clienteSearch.length >= 1 && (
                    <div className="absolute z-10 w-full mt-1 rounded-xl shadow-lg overflow-hidden" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                      {clientiFiltrati.length === 0 ? (
                        <div className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                          Nessun cliente trovato
                        </div>
                      ) : (
                        clientiFiltrati.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { setClienteSelezionato(c); setClienteSearch(""); }}
                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-[#F1F4F8] transition-colors"
                            style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
                          >
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
                  className="w-full px-4 py-2.5 rounded-xl text-sm" style={inputStyle} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                  Ora <span style={{ color: "#EF4444" }}>*</span>
                </label>
                <input type="time" value={ora} onChange={(e) => setOra(e.target.value)} required
                  className="w-full px-4 py-2.5 rounded-xl text-sm" style={inputStyle} />
              </div>
            </div>

            {/* Sede */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                Sede <span style={{ color: "#EF4444" }}>*</span>
              </label>
              <select value={sedeId} onChange={(e) => setSedeId(e.target.value)} required
                className="w-full px-4 py-2.5 rounded-xl text-sm"
                style={{ ...inputStyle, color: sedeId ? "var(--text-primary)" : "var(--text-muted)" }}>
                <option value="">Seleziona sede…</option>
                {sedi.map((s) => <option key={s.id} value={s.id}>{s.Nome}</option>)}
              </select>
            </div>

            {/* Operatore */}
            {operatori.length > 0 && (
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                  Operatore
                </label>
                <select value={operatoreId} onChange={(e) => setOperatoreId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl text-sm"
                  style={{ ...inputStyle, color: operatoreId ? "var(--text-primary)" : "var(--text-muted)" }}>
                  <option value="">— Nessun operatore —</option>
                  {operatori.map((o) => <option key={o.id} value={o.id}>{nomeOperatore(o)}</option>)}
                </select>
              </div>
            )}

            {/* Veicolo */}
            {clienteSelezionato && (
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                  Veicolo
                </label>
                {veicoliCliente.length === 0 ? (
                  <p className="text-sm px-4 py-2.5 rounded-xl" style={{ border: "1px solid var(--border)", color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                    Nessun veicolo registrato per questo cliente
                  </p>
                ) : (
                  <select value={veicoloId} onChange={(e) => setVeicoloId(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm" style={inputStyle}>
                    <option value="">Nessun veicolo</option>
                    {veicoliCliente.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.Marca} {v.Modello}{v.Targa ? ` — ${v.Targa}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Tipo intervento */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                Tipo intervento
              </label>
              <input type="text" value={servizio} onChange={(e) => setServizio(e.target.value)}
                placeholder="Es. Cambio pneumatici, Revisione…"
                className="w-full px-4 py-2.5 rounded-xl text-sm" style={inputStyle} />
            </div>

            {/* Pneumatici */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                  Pneumatici
                </label>
                <button
                  type="button"
                  onClick={addPneumatico}
                  className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg"
                  style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
                >
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
                          placeholder="Marca" className="w-full px-3 py-2 rounded-lg text-xs" style={inputStyle} />
                      </div>
                      <div className="col-span-3">
                        <input type="text" value={p.Misura} onChange={(e) => updatePneumatico(idx, "Misura", e.target.value)}
                          placeholder="205/55R16" className="w-full px-3 py-2 rounded-lg text-xs" style={inputStyle} />
                      </div>
                      <div className="col-span-3">
                        <select value={p.Stagione} onChange={(e) => updatePneumatico(idx, "Stagione", e.target.value)}
                          className="w-full px-2 py-2 rounded-lg text-xs" style={inputStyle}>
                          <option value="Estive">Estive</option>
                          <option value="Invernali">Invernali</option>
                          <option value="4 Stagioni">4 Stagioni</option>
                        </select>
                      </div>
                      <div className="col-span-1">
                        <input type="number" value={p.Quantita} min={1} max={20}
                          onChange={(e) => updatePneumatico(idx, "Quantita", Number(e.target.value))}
                          className="w-full px-2 py-2 rounded-lg text-xs text-center" style={inputStyle} />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <button type="button" onClick={() => removePneumatico(idx)}
                          className="p-1 rounded-lg hover:bg-red-50 transition-colors">
                          <X size={14} style={{ color: "#EF4444" }} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                    Marca · Misura · Stagione · Qtà
                  </p>
                </div>
              )}
            </div>

            {/* Note */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                Note
              </label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Note aggiuntive…" rows={3}
                className="w-full px-4 py-2.5 rounded-xl text-sm resize-none" style={inputStyle} />
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
              {saving ? "Salvataggio…" : "Crea appuntamento"}
            </button>
          </div>
        </Card>
      </form>
    </div>
  );
}
