"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  collection, getDocs, updateDoc, getDoc, orderBy, query,
  serverTimestamp, doc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ArrowLeft, Search, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";
import type { Cliente, Veicolo, Sede, Pneumatico, FoglioDiLavoro } from "@/lib/types";

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
  Marca: "", Modello: "", Misura: "", Stagione: "Estive", Quantita: 4, Stato: "montati",
});

function toPneumaticoForm(p: Pneumatico, stato: "montati" | "smontati"): PneumaticoForm {
  return {
    Marca: p.Marca ?? "",
    Modello: p.Modello ?? "",
    Misura: p.Misura ?? "",
    Stagione: p.Stagione ?? "Estive",
    Quantita: p.Quantita ?? 4,
    Stato: stato,
  };
}

export default function ModificaFoglioLavoroPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [sedi, setSedi] = useState<Sede[]>([]);
  const [clienti, setClienti] = useState<Cliente[]>([]);
  const [clienteSearch, setClienteSearch] = useState("");
  const [clienteSelezionato, setClienteSelezionato] = useState<Cliente | null>(null);
  const [veicoliCliente, setVeicoliCliente] = useState<Veicolo[]>([]);

  const [sedeId, setSedeId] = useState("");
  const [veicoloId, setVeicoloId] = useState("");
  const [pneumatici, setPneumatici] = useState<PneumaticoForm[]>([]);
  const [note, setNote] = useState("");
  const [statoFoglio, setStatoFoglio] = useState("Aperto");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      const [foglioSnap, sediSnap, clientiSnap] = await Promise.all([
        getDoc(doc(db, "Foglio_di_Lavoro", id)),
        getDocs(collection(db, "Sede")),
        getDocs(query(collection(db, "Clienti"), orderBy("Nome"))),
      ]);

      if (!foglioSnap.exists()) {
        toast.error("Foglio non trovato");
        router.push("/fogli-di-lavoro");
        return;
      }

      const foglio = { id: foglioSnap.id, ...foglioSnap.data() } as FoglioDiLavoro;
      const allSedi = sediSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Sede));
      const allClienti = clientiSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Cliente));

      setSedi(allSedi);
      setClienti(allClienti);

      if (foglio.Stato) setStatoFoglio(foglio.Stato);
      const noteField = (foglio as Record<string, unknown>).Note;
      if (noteField) setNote(noteField as string);

      // Pneumatici montati + smontati
      const montati = ((foglio as Record<string, unknown>).Pneumatici_Montati as Pneumatico[] | undefined) ?? [];
      const smontati = ((foglio as Record<string, unknown>).Pneumatici_Smontati as Pneumatico[] | undefined) ?? [];
      setPneumatici([
        ...montati.map((p) => toPneumaticoForm(p, "montati")),
        ...smontati.map((p) => toPneumaticoForm(p, "smontati")),
      ]);

      // Sede
      const sedeRef = foglio.Sede as { id?: string; path?: string } | null | undefined;
      if (sedeRef) {
        const sid = sedeRef.id ?? sedeRef.path?.split("/").pop() ?? "";
        setSedeId(sid);
      }

      // Cliente
      const clienteRef = foglio.Cliente as { id?: string; path?: string } | null | undefined;
      if (clienteRef) {
        const cid = clienteRef.id ?? clienteRef.path?.split("/").pop() ?? "";
        const found = allClienti.find((c) => c.id === cid);
        if (found) {
          setClienteSelezionato(found);
          const vSnap = await getDocs(collection(db, "Clienti", cid, "Veicolo"));
          const veicoli = vSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Veicolo));
          setVeicoliCliente(veicoli);

          const veicoloRef = foglio.Veicolo as { id?: string; path?: string } | null | undefined;
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

  function addPneumatico() { setPneumatici((p) => [...p, emptyPneumatico()]); }
  function removePneumatico(i: number) { setPneumatici((p) => p.filter((_, idx) => idx !== i)); }
  function updatePneumatico(i: number, field: keyof PneumaticoForm, value: string | number) {
    setPneumatici((p) => p.map((x, idx) => (idx === i ? { ...x, [field]: value } : x)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteSelezionato || !sedeId) {
      toast.error("Compila i campi obbligatori (cliente, sede)");
      return;
    }
    setSaving(true);
    try {
      const toPneumatico = (p: PneumaticoForm): Pneumatico => ({
        Marca: p.Marca, Modello: p.Modello, Misura: p.Misura, Stagione: p.Stagione, Quantita: p.Quantita,
      });

      const montati = pneumatici.filter((p) => p.Stato === "montati").map(toPneumatico);
      const smontati = pneumatici.filter((p) => p.Stato === "smontati").map(toPneumatico);

      const payload: Record<string, unknown> = {
        Cliente: doc(db, "Clienti", clienteSelezionato.id),
        Sede: doc(db, "Sede", sedeId),
        Stato: statoFoglio,
        DataModifica: serverTimestamp(),
        Pneumatici_Montati: montati,
        Pneumatici_Smontati: smontati,
        Note: note.trim() || null,
      };

      if (veicoloId) {
        payload.Veicolo = doc(db, "Clienti", clienteSelezionato.id, "Veicolo", veicoloId);
      }

      await updateDoc(doc(db, "Foglio_di_Lavoro", id), payload);
      toast.success("Foglio aggiornato");
      router.push(`/fogli-di-lavoro/${id}`);
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
        <Link href={`/fogli-di-lavoro/${id}`}
          className="p-2 rounded-xl transition-colors hover:bg-[#F1F4F8]"
          style={{ border: "1px solid var(--border)" }}>
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
          Modifica foglio di lavoro
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card>
          <h2 className="text-sm font-bold mb-4 uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
            Dati veicolo e cliente
          </h2>
          <div className="space-y-4">
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
                  <button type="button" onClick={() => { setClienteSelezionato(null); setClienteSearch(""); setVeicoliCliente([]); setVeicoloId(""); }}
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

            {/* Stato foglio */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>Stato</label>
              <select value={statoFoglio} onChange={(e) => setStatoFoglio(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}>
                <option value="Aperto">Aperto</option>
                <option value="In lavorazione">In lavorazione</option>
                <option value="Completato">Completato</option>
                <option value="Chiuso">Chiuso</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Pneumatici */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>Pneumatici</h2>
            <button type="button" onClick={addPneumatico}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}>
              <Plus size={13} /> Aggiungi
            </button>
          </div>

          {pneumatici.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>Nessun pneumatico</p>
          ) : (
            <div className="space-y-4">
              {pneumatici.map((p, i) => (
                <div key={i} className="p-4 rounded-xl space-y-3" style={{ border: "1px solid var(--border)", background: "var(--bg-primary)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>Pneumatico {i + 1}</span>
                    <button type="button" onClick={() => removePneumatico(i)} className="p-1 rounded hover:bg-red-50" style={{ color: "#EF4444" }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    {(["montati", "smontati"] as const).map((stato) => (
                      <button key={stato} type="button" onClick={() => updatePneumatico(i, "Stato", stato)}
                        className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors capitalize"
                        style={{ background: p.Stato === stato ? "var(--brand)" : "var(--bg-secondary)", color: p.Stato === stato ? "#111" : "var(--text-muted)", fontFamily: "var(--font-montserrat)", border: "1px solid var(--border)" }}>
                        Da {stato}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {(["Marca", "Modello"] as const).map((field) => (
                      <div key={field}>
                        <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>{field}</label>
                        <input type="text" value={p[field]} onChange={(e) => updatePneumatico(i, field, e.target.value)}
                          placeholder={field} className="w-full px-3 py-2 rounded-lg text-sm"
                          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }} />
                      </div>
                    ))}
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>Misura</label>
                      <input type="text" value={p.Misura} onChange={(e) => updatePneumatico(i, "Misura", e.target.value)}
                        placeholder="Es. 205/55R16" className="w-full px-3 py-2 rounded-lg text-sm"
                        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>Qtà</label>
                      <input type="number" min={1} max={20} value={p.Quantita} onChange={(e) => updatePneumatico(i, "Quantita", Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg text-sm"
                        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>Stagione</label>
                    <select value={p.Stagione} onChange={(e) => updatePneumatico(i, "Stagione", e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-sm"
                      style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }}>
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
          <label className="block text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>Note</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note sull'intervento…" rows={3}
            className="w-full px-4 py-2.5 rounded-xl text-sm resize-none"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-primary)", outline: "none" }} />
        </Card>

        <div className="flex justify-end gap-3">
          <Link href={`/fogli-di-lavoro/${id}`}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
            Annulla
          </Link>
          <button type="submit" disabled={saving}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}>
            {saving ? "Salvataggio…" : "Salva modifiche"}
          </button>
        </div>
      </form>
    </div>
  );
}
