"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/layout/AuthProvider";
import { useCart } from "@/components/layout/CartProvider";
import { ArrowLeft, Plus, Minus, ShoppingCart, Package, CheckCircle } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import toast from "react-hot-toast";

type RawProdotto = {
  Nome?: string;
  Marca?: string;
  Modello?: string;
  Larghezza?: string | number;
  Altezza?: string | number;
  Diametro?: string | number;
  Indice_carico?: string;
  Codice_velocita?: string;
  Stagione?: string;
  Categoria?: string;
  PFU?: number;
  EAN?: string;
  Immagine?: string;
  Foto?: string;
  Descrizione?: string;
  // Stock per deposito
  Stock_Nola?: number;
  Stock_Nola_2?: number;
  Stock_Volla?: number;
  Stock_Roma?: number;
  Stock_Portici?: number;
  Stock_OCP?: number;
  Stock_T24?: number;
  // Prezzi per ruolo
  Prezzo_Gommista?: number;
  Prezzo_Grossista?: number;
  Prezzo_Privato?: number;
  Prezzo_T24?: number;
  Prezzo_Acquisto?: number;
};

const STOCK_DEPOSITI = [
  { key: "Stock_Nola",     label: "Nola" },
  { key: "Stock_Nola_2",   label: "Nola 2" },
  { key: "Stock_Volla",    label: "Volla" },
  { key: "Stock_Roma",     label: "Roma" },
  { key: "Stock_Portici",  label: "Portici" },
  { key: "Stock_OCP",      label: "OCP" },
  { key: "Stock_T24",      label: "T24 (dropship)" },
] as const;

function getPrezzo(p: RawProdotto, ruolo: string): number {
  switch (ruolo) {
    case "Gommista":   return p.Prezzo_Gommista  ?? p.Prezzo_Privato ?? 0;
    case "Grossista":  return p.Prezzo_Grossista  ?? p.Prezzo_Privato ?? 0;
    default:           return p.Prezzo_Privato    ?? 0;
  }
}

function euro(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function stagioneBadge(s?: string): "success" | "brand" | "neutral" {
  if (!s) return "neutral";
  if (s.toLowerCase().includes("estiv")) return "success";
  if (s.toLowerCase().includes("invern")) return "brand";
  return "neutral";
}

export default function ProdottoDetailPage() {
  const params = useParams();
  const id     = params.id as string;
  const { user } = useAuth();
  const { add: addToCart } = useCart();

  const [prodotto, setProdotto] = useState<RawProdotto | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [quantita, setQuantita] = useState(1);
  const [added,    setAdded]    = useState(false);

  const ruolo: string = (user as { Ruolo?: string } | null)?.Ruolo ?? "Privato";

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "Prodotti", id));
        if (snap.exists()) {
          setProdotto(snap.data() as RawProdotto);
        } else {
          toast.error("Prodotto non trovato");
        }
      } catch {
        toast.error("Errore nel caricamento");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  function handleAdd() {
    if (!prodotto) return;
    const prezzo = getPrezzo(prodotto, ruolo);
    const pfu    = prodotto.PFU ?? 0;
    const misura = [prodotto.Larghezza, prodotto.Altezza, `R${prodotto.Diametro}`].filter(Boolean).join("/");
    const titolo = prodotto.Nome ?? `${prodotto.Marca ?? ""} ${prodotto.Modello ?? ""}`.trim();
    const totalStock = STOCK_DEPOSITI.reduce((s, d) => s + ((prodotto as Record<string, unknown>)[d.key] as number ?? 0), 0);

    if (quantita > totalStock) {
      toast.error(`Stock insufficiente (${totalStock} disponibili)`);
      return;
    }

    addToCart({
      id,
      marca:    prodotto.Marca ?? "",
      modello:  prodotto.Modello ?? prodotto.Nome ?? "",
      misura:   [prodotto.Larghezza, prodotto.Altezza, `R${prodotto.Diametro}`].filter(Boolean).join("/"),
      stagione: prodotto.Stagione ?? "",
      prezzo,
      pfu,
      quantita,
      stockMax: totalStock,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2500);
    toast.success(`${quantita} pz aggiunto al carrello`);
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse max-w-4xl mx-auto">
        <div className="h-5 w-32 rounded-xl" style={{ background: "var(--bg-secondary)" }} />
        <div className="h-72 rounded-2xl" style={{ background: "var(--bg-secondary)" }} />
        <div className="h-48 rounded-2xl" style={{ background: "var(--bg-secondary)" }} />
      </div>
    );
  }

  if (!prodotto) {
    return (
      <div className="text-center py-20" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
        <p className="text-sm">Prodotto non trovato.</p>
        <Link href="/prodotti" className="text-sm font-semibold mt-3 inline-block" style={{ color: "var(--brand)" }}>
          ← Torna ai prodotti
        </Link>
      </div>
    );
  }

  const prezzo      = getPrezzo(prodotto, ruolo);
  const pfu         = prodotto.PFU ?? 0;
  const prezzoLordo = (prezzo + pfu) * 1.22;
  const misura      = [prodotto.Larghezza, prodotto.Altezza, `R${prodotto.Diametro}`].filter(Boolean).join("/");
  const titolo      = prodotto.Nome ?? `${prodotto.Marca ?? ""} ${prodotto.Modello ?? ""}`.trim();
  const totalStock  = STOCK_DEPOSITI.reduce((s, d) => s + ((prodotto as Record<string, unknown>)[d.key] as number ?? 0), 0);
  const imgSrc      = prodotto.Immagine ?? prodotto.Foto ?? "";

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <Link
        href="/prodotti"
        className="inline-flex items-center gap-1.5 text-sm font-medium"
        style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
      >
        <ArrowLeft size={15} /> Prodotti
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Immagine */}
        <Card padding="sm">
          <div className="aspect-square rounded-xl overflow-hidden flex items-center justify-center"
            style={{ background: "var(--bg-primary)" }}>
            {imgSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imgSrc} alt={titolo} className="w-full h-full object-contain p-4" />
            ) : (
              <Package size={64} style={{ color: "var(--text-muted)", opacity: 0.3 }} />
            )}
          </div>
        </Card>

        {/* Info + acquisto */}
        <div className="space-y-4">
          <Card>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  {prodotto.Marca}
                </p>
                <h1 className="text-xl font-bold leading-tight" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                  {titolo}
                </h1>
                {misura && (
                  <p className="text-sm mt-1 font-mono" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                    {misura}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {prodotto.Stagione && (
                  <Badge variant={stagioneBadge(prodotto.Stagione)}>{prodotto.Stagione}</Badge>
                )}
                {prodotto.Categoria && (
                  <Badge variant="neutral">{prodotto.Categoria}</Badge>
                )}
              </div>

              {/* Prezzi */}
              <div className="pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                <div className="flex items-end gap-3">
                  <div>
                    <p className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                      Prezzo ({ruolo})
                    </p>
                    <p className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
                      {euro(prezzo)}
                    </p>
                  </div>
                  <div className="pb-0.5">
                    <p className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                      PFU: {euro(pfu)}
                    </p>
                    <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                      Lordo: {euro(prezzoLordo)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Stock totale */}
              <div className="flex items-center gap-2">
                {totalStock > 0 ? (
                  <CheckCircle size={14} style={{ color: "#249689" }} />
                ) : (
                  <Package size={14} style={{ color: "#EF4444" }} />
                )}
                <span className="text-sm font-semibold" style={{
                  color: totalStock > 0 ? "#249689" : "#EF4444",
                  fontFamily: "var(--font-montserrat)",
                }}>
                  {totalStock > 0 ? `${totalStock} pz disponibili` : "Non disponibile"}
                </span>
              </div>

              {/* Quantità + aggiungi */}
              {totalStock > 0 && (
                <div className="flex items-center gap-3 pt-1">
                  <div className="flex items-center rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                    <button
                      onClick={() => setQuantita((q) => Math.max(1, q - 1))}
                      className="px-3 py-2 hover:bg-[#F1F4F8] transition-colors"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <Minus size={14} />
                    </button>
                    <span className="px-4 py-2 text-sm font-bold min-w-[48px] text-center"
                      style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-primary)" }}>
                      {quantita}
                    </span>
                    <button
                      onClick={() => setQuantita((q) => Math.min(totalStock, q + 1))}
                      className="px-3 py-2 hover:bg-[#F1F4F8] transition-colors"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  <button
                    onClick={handleAdd}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all"
                    style={{ background: added ? "#249689" : "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
                  >
                    {added ? <CheckCircle size={16} /> : <ShoppingCart size={16} />}
                    {added ? "Aggiunto!" : "Aggiungi al carrello"}
                  </button>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Specifiche tecniche */}
      <Card>
        <h2 className="text-sm font-bold mb-4" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
          Specifiche tecniche
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: "Larghezza",   value: prodotto.Larghezza ? `${prodotto.Larghezza} mm` : "—" },
            { label: "Altezza",     value: prodotto.Altezza ? `${prodotto.Altezza}%` : "—" },
            { label: "Diametro",    value: prodotto.Diametro ? `R${prodotto.Diametro}"` : "—" },
            { label: "Stagione",    value: prodotto.Stagione ?? "—" },
            { label: "Categoria",   value: prodotto.Categoria ?? "—" },
            { label: "Ind. carico", value: prodotto.Indice_carico ?? "—" },
            { label: "Ind. velocità", value: prodotto.Codice_velocita ?? "—" },
            { label: "EAN",         value: prodotto.EAN ?? "—" },
          ].map(({ label, value }) => (
            <div key={label} className="px-3 py-2.5 rounded-xl" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                {label}
              </p>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}>
                {value}
              </p>
            </div>
          ))}
        </div>

        {prodotto.Descrizione && (
          <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
              Descrizione
            </p>
            <p className="text-sm" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)", lineHeight: 1.6 }}>
              {prodotto.Descrizione}
            </p>
          </div>
        )}
      </Card>

      {/* Stock per deposito */}
      <Card>
        <h2 className="text-sm font-bold mb-4" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
          Disponibilità per deposito
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {STOCK_DEPOSITI.map(({ key, label }) => {
            const qty = (prodotto as Record<string, unknown>)[key] as number ?? 0;
            return (
              <div key={key} className="px-3 py-2.5 rounded-xl text-center"
                style={{ background: qty > 0 ? "#F0FDF4" : "var(--bg-primary)", border: `1px solid ${qty > 0 ? "#BBF7D0" : "var(--border)"}` }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: qty > 0 ? "#166534" : "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
                  {label}
                </p>
                <p className="text-xl font-bold" style={{ color: qty > 0 ? "#166534" : "var(--text-muted)", fontFamily: "var(--font-poppins)" }}>
                  {qty}
                </p>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
