"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  collection, query, getDocs, addDoc, orderBy,
  serverTimestamp, doc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { nextCounter } from "@/lib/counters";
import { ArrowLeft, Search, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";
import type { Cliente, Veicolo, Sede, Pneumatico } from "@/lib/types";

function nomeCliente(c: Cliente): string {
  if (c.Azienda && c.Ragione_Sociale) return c.Ragione_Sociale;
  return c.Nome?.trim() || c.Ragione_Sociale || "—";
}

type PneumaticoForm = {
  Marca: string;
  Modello: string;
  Misura: string;
  Stagione: string;
  Quantita: number;
  Stato: "montati" | "smontati";
};

const emptyPneumatico = (): PneumaticoForm => ({
  Marca: "",
  Modello: "",
  Misura: "",
  Stagione: "Estive",
  Quantita: 4,
  Stato: "montati",
});

export default function NuovoFoglioLavoroPage() {
  const router = useRouter();

  const [sedi, setSedi] = useState<Sede[]>([]);
  const [clienti, setClienti] = useState<Cliente[]>([]);
  const [clienteSearch, setClienteSearch] = useState("");
  const [clienteSelezionato, setClienteSelezionato] = useState<Cliente | null>(null);
  const [veicoliCliente, setVeicoliCliente] = useState<Veicolo[]>([]);

  const [sedeId, setSedeId] = useState("");
  const [veicoloId, setVeicoloId] = useState("");
  const [pneumatici, setPneumatici] = useState<PneumaticoForm[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDocs(collection(db, "Sede")).then((snap) => {
      setSedi(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Sede)));
    });
    getDocs(query(collection(db, "Clienti"), orderBy("Nome"))).then((snap) => {
      setClienti(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Cliente)));
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

  function removePneumatico(index: number) {
    setPneumatici((prev) => prev.filter((_, i) => i !== index));
  }

  function updatePneumatico(index: number, field: keyof PneumaticoForm, value: string | number) {
    setPneumatici((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteSelezionato || !sedeId) {
      toast.error("Compila i campi obbligatori (cliente, sede)");
      return;
    }
    if (!veicoloId && veicoliCliente.length > 0) {
      toast.error("Seleziona il veicolo");
      return;
    }
    setSaving(true);
    try {
      const toPneumatico = (p: PneumaticoForm): Pneumatico => ({
        Marca:    p.Marca,
        Modello:  p.Modello,
        Misura:   p.Misura,
        Stagione: p.Stagione,
        Quantita: p.Quantita,
      });

      const montati: Pneumatico[] = pneumatici
        .filter((p) => p.Stato === "montati")
        .map(toPneumatico);

      const smontati: Pneumatico[] = pneumatici
        .filter((p) => p.Stato === "smontati")
        .map(toPneumatico);

      // Numero progressivo per sede (atomico via transaction).
      const numero = await nextCounter("FoglioDiLavoro", sedeId);

      const payload: Record<string, unknown> = {
        Cliente: doc(db, "Clienti", clienteSelezionato.id),
        Sede: doc(db, "Sede", sedeId),
        Stato: "Aperto",
        ID: numero,
        Numero: numero,
        Data_Creazione: serverTimestamp(),
        ...(montati.length > 0 && { Pneumatici_Montati: montati }),
        ...(smontati.length > 0 && { Pneumatici_Smontati: smontati }),
        ...(note.trim() && { Note: note.trim() }),
      };

      if (veicoloId) {
        payload.Veicolo = doc(db, "Clienti", clienteSelezionato.id, "Veicolo", veicoloId);
      }

      await addDoc(collection(db, "Foglio_di_Lavoro"), payload);
      toast.success("Foglio di lavoro creato");
      router.push("/fogli-di-lavoro");
    } catch (err) {
      console.error(err);
      toast.error("Errore nella creazione del foglio");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link
          href="/fogli-di-lavoro"
          className="p-2 rounded-xl transition-colors hover:bg-[#F1F4F8]"
          style={{ border: "1px solid var(--border)" }}
        >
          <ArrowLeft size={16} />
        </Link>
        <h1
          className="text-2xl font-bold"
          style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}
        >
          Nuovo foglio di lavoro
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Dati principali */}
        <Card>
          <h2
            className="text-sm font-bold mb-4 uppercase tracking-wider"
            style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
          >
            Dati veicolo e cliente
          </h2>
          <div className="space-y-4">
            {/* Cliente */}
            <div>
              <label
                className="block text-sm font-semibold mb-1.5"
                style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
              >
                Cliente <span style={{ color: "#EF4444" }}>*</span>
              </label>
              {clienteSelezionato ? (
                <div
                  className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ border: "1px solid var(--brand)", background: "var(--bg-primary)" }}
                >
                  <span
                    className="flex-1 text-sm font-semibold"
                    style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
                  >
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
                    style={{
                      background: "var(--bg-primary)",
                      border: "1px solid var(--border)",
                      fontFamily: "var(--font-montserrat)",
                      color: "var(--text-primary)",
                      outline: "none",
                    }}
                  />
                  {clienteSearch.length >= 1 && (
                    <div
                      className="absolute z-10 w-full mt-1 rounded-xl shadow-lg overflow-hidden"
                      style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
                    >
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
                            {c.Telefono && (
                              <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                                {c.Telefono}
                              </span>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Veicolo */}
            {clienteSelezionato && (
              <div>
                <label
                  className="block text-sm font-semibold mb-1.5"
                  style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
                >
                  Veicolo
                </label>
                {veicoliCliente.length === 0 ? (
                  <p
                    className="text-sm px-4 py-2.5 rounded-xl"
                    style={{ border: "1px solid var(--border)", color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
                  >
                    Nessun veicolo registrato per questo cliente
                  </p>
                ) : (
                  <select
                    value={veicoloId}
                    onChange={(e) => setVeicoloId(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm"
                    style={{
                      background: "var(--bg-primary)",
                      border: "1px solid var(--border)",
                      fontFamily: "var(--font-montserrat)",
                      color: "var(--text-primary)",
                      outline: "none",
                    }}
                  >
                    <option value="">Nessun veicolo</option>
                    {veicoliCliente.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.Marca} {v.Modello}
                        {v.Targa ? ` — ${v.Targa}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Sede */}
            <div>
              <label
                className="block text-sm font-semibold mb-1.5"
                style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
              >
                Sede <span style={{ color: "#EF4444" }}>*</span>
              </label>
              <select
                value={sedeId}
                onChange={(e) => setSedeId(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded-xl text-sm"
                style={{
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border)",
                  fontFamily: "var(--font-montserrat)",
                  color: sedeId ? "var(--text-primary)" : "var(--text-muted)",
                  outline: "none",
                }}
              >
                <option value="">Seleziona sede…</option>
                {sedi.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.Nome}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        {/* Pneumatici */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2
              className="text-sm font-bold uppercase tracking-wider"
              style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
            >
              Pneumatici
            </h2>
            <button
              type="button"
              onClick={addPneumatico}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
            >
              <Plus size={13} /> Aggiungi
            </button>
          </div>

          {pneumatici.length === 0 ? (
            <p
              className="text-sm text-center py-4"
              style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
            >
              Nessun pneumatico aggiunto
            </p>
          ) : (
            <div className="space-y-4">
              {pneumatici.map((p, i) => (
                <div
                  key={i}
                  className="p-4 rounded-xl space-y-3"
                  style={{ border: "1px solid var(--border)", background: "var(--bg-primary)" }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className="text-xs font-bold uppercase tracking-wider"
                      style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
                    >
                      Pneumatico {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removePneumatico(i)}
                      className="p-1 rounded hover:bg-red-50"
                      style={{ color: "#EF4444" }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Tipo: montati/smontati */}
                  <div className="flex gap-2">
                    {(["montati", "smontati"] as const).map((stato) => (
                      <button
                        key={stato}
                        type="button"
                        onClick={() => updatePneumatico(i, "Stato", stato)}
                        className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors capitalize"
                        style={{
                          background: p.Stato === stato ? "var(--brand)" : "var(--bg-secondary)",
                          color: p.Stato === stato ? "#111" : "var(--text-muted)",
                          fontFamily: "var(--font-montserrat)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        Da {stato}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {(["Marca", "Modello"] as const).map((field) => (
                      <div key={field}>
                        <label
                          className="block text-xs font-semibold mb-1"
                          style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
                        >
                          {field}
                        </label>
                        <input
                          type="text"
                          value={p[field]}
                          onChange={(e) => updatePneumatico(i, field, e.target.value)}
                          placeholder={field}
                          className="w-full px-3 py-2 rounded-lg text-sm"
                          style={{
                            background: "var(--bg-secondary)",
                            border: "1px solid var(--border)",
                            fontFamily: "var(--font-montserrat)",
                            color: "var(--text-primary)",
                            outline: "none",
                          }}
                        />
                      </div>
                    ))}
                    <div>
                      <label
                        className="block text-xs font-semibold mb-1"
                        style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
                      >
                        Misura
                      </label>
                      <input
                        type="text"
                        value={p.Misura}
                        onChange={(e) => updatePneumatico(i, "Misura", e.target.value)}
                        placeholder="Es. 205/55R16"
                        className="w-full px-3 py-2 rounded-lg text-sm"
                        style={{
                          background: "var(--bg-secondary)",
                          border: "1px solid var(--border)",
                          fontFamily: "var(--font-montserrat)",
                          color: "var(--text-primary)",
                          outline: "none",
                        }}
                      />
                    </div>
                    <div>
                      <label
                        className="block text-xs font-semibold mb-1"
                        style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
                      >
                        Qtà
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={p.Quantita}
                        onChange={(e) => updatePneumatico(i, "Quantita", Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg text-sm"
                        style={{
                          background: "var(--bg-secondary)",
                          border: "1px solid var(--border)",
                          fontFamily: "var(--font-montserrat)",
                          color: "var(--text-primary)",
                          outline: "none",
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      className="block text-xs font-semibold mb-1"
                      style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
                    >
                      Stagione
                    </label>
                    <select
                      value={p.Stagione}
                      onChange={(e) => updatePneumatico(i, "Stagione", e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-sm"
                      style={{
                        background: "var(--bg-secondary)",
                        border: "1px solid var(--border)",
                        fontFamily: "var(--font-montserrat)",
                        color: "var(--text-primary)",
                        outline: "none",
                      }}
                    >
                      <option value="Estive">Estive</option>
                      <option value="Invernali">Invernali</option>
                      <option value="4-Stagioni">4 Stagioni</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Note */}
        <Card>
          <label
            className="block text-sm font-semibold mb-2"
            style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}
          >
            Note
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note sull'intervento…"
            rows={3}
            className="w-full px-4 py-2.5 rounded-xl text-sm resize-none"
            style={{
              background: "var(--bg-primary)",
              border: "1px solid var(--border)",
              fontFamily: "var(--font-montserrat)",
              color: "var(--text-primary)",
              outline: "none",
            }}
          />
        </Card>

        <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
          <Link
            href="/fogli-di-lavoro"
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-center"
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              fontFamily: "var(--font-montserrat)",
              color: "var(--text-secondary)",
            }}
          >
            Annulla
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
          >
            {saving ? "Salvataggio…" : "Crea foglio di lavoro"}
          </button>
        </div>
      </form>
    </div>
  );
}
