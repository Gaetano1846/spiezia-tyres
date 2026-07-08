"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, Search, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import toast from "react-hot-toast";
import type { SimpleEntity } from "@/lib/lookupDb";
import type { PneumaticoFoglio } from "@/lib/fogliDb";

type ClienteOption = { id: string; nome: string; telefono?: string };
type VeicoloOption = { id: string; Marca?: string; Modello?: string; Targa?: string };

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

function toPneumaticoForm(p: PneumaticoFoglio, stato: "montati" | "smontati"): PneumaticoForm {
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
  const [sedi, setSedi] = useState<SimpleEntity[]>([]);
  const [clienteSearch, setClienteSearch] = useState("");
  const [clientiSuggeriti, setClientiSuggeriti] = useState<ClienteOption[]>([]);
  const [clienteSelezionato, setClienteSelezionato] = useState<ClienteOption | null>(null);
  const [veicoliCliente, setVeicoliCliente] = useState<VeicoloOption[]>([]);

  const [sedeId, setSedeId] = useState("");
  const [veicoloId, setVeicoloId] = useState("");
  const [pneumatici, setPneumatici] = useState<PneumaticoForm[]>([]);
  const [note, setNote] = useState("");
  const [statoFoglio, setStatoFoglio] = useState("Aperto");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      const [foglioRes, sediRes] = await Promise.all([
        fetch(`/api/fogli-di-lavoro/${id}`),
        fetch("/api/lookup/sede"),
      ]);

      if (!foglioRes.ok) {
        toast.error("Foglio non trovato");
        router.push("/fogli-di-lavoro");
        return;
      }

      const { foglio } = await foglioRes.json();
      const { items: allSedi } = await sediRes.json();
      setSedi(allSedi ?? []);

      setStatoFoglio(foglio.Stato ?? "Aperto");
      setNote(foglio.Note ?? "");
      setSedeId(foglio.SedeId ?? "");

      const montati  = (foglio.PneumaticiMontati  as PneumaticoFoglio[]) ?? [];
      const smontati = (foglio.PneumaticiSmontati as PneumaticoFoglio[]) ?? [];
      setPneumatici([
        ...montati.map((p) => toPneumaticoForm(p, "montati")),
        ...smontati.map((p) => toPneumaticoForm(p, "smontati")),
      ]);

      if (foglio.ClienteId) {
        setClienteSelezionato({ id: foglio.ClienteId, nome: foglio.ClienteNome, telefono: foglio.ClienteTelefono ?? undefined });
        const vRes = await fetch(`/api/clienti/${foglio.ClienteId}/veicoli`);
        const { veicoli } = await vRes.json();
        setVeicoliCliente(veicoli ?? []);
        if (foglio.VeicoloId) setVeicoloId(foglio.VeicoloId);
      }

      setLoading(false);
    };

    fetchAll().catch((err) => {
      console.error(err);
      toast.error("Errore nel caricamento");
      setLoading(false);
    });
  }, [id, router]);

  useEffect(() => {
    if (clienteSearch.trim().length < 1) {
      setClientiSuggeriti([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/clienti?q=${encodeURIComponent(clienteSearch.trim())}&limit=8`)
        .then((r) => r.json())
        .then(({ clienti }) => {
          setClientiSuggeriti((clienti ?? []).map((c: Record<string, unknown>) => ({
            id: c.id as string,
            nome: (c.Azienda && c.Ragione_Sociale) ? (c.Ragione_Sociale as string) : ((c.Nome as string)?.trim() || (c.Ragione_Sociale as string) || "—"),
            telefono: c.Telefono as string | undefined,
          })));
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [clienteSearch]);

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
      const toPneumatico = (p: PneumaticoForm): PneumaticoFoglio => ({
        Marca: p.Marca, Modello: p.Modello, Misura: p.Misura, Stagione: p.Stagione, Quantita: p.Quantita,
      });

      const montati = pneumatici.filter((p) => p.Stato === "montati").map(toPneumatico);
      const smontati = pneumatici.filter((p) => p.Stato === "smontati").map(toPneumatico);

      const res = await fetch(`/api/fogli-di-lavoro/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteId: clienteSelezionato.id,
          sedeId,
          veicoloId: veicoloId || undefined,
          stato: statoFoglio,
          pneumaticiMontati: montati,
          pneumaticiSmontati: smontati,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));

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
                    {clienteSelezionato.nome}
                    {clienteSelezionato.telefono && (
                      <span className="ml-2 font-normal text-xs" style={{ color: "var(--text-muted)" }}>{clienteSelezionato.telefono}</span>
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
                      {clientiSuggeriti.length === 0 ? (
                        <div className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>Nessun cliente trovato</div>
                      ) : (
                        clientiSuggeriti.map((c) => (
                          <button key={c.id} type="button"
                            onClick={async () => {
                              setClienteSelezionato(c);
                              setClienteSearch("");
                              setVeicoloId("");
                              const vRes = await fetch(`/api/clienti/${c.id}/veicoli`);
                              const { veicoli } = await vRes.json();
                              setVeicoliCliente(veicoli ?? []);
                            }}
                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-[#F1F4F8] transition-colors"
                            style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                            {c.nome}
                            {c.telefono && <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>{c.telefono}</span>}
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

        <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
          <Link href={`/fogli-di-lavoro/${id}`}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-center"
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
