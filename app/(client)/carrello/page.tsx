"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Package, Plus, Minus, X, Tag, ShoppingCart, Percent, Truck } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { useCart } from "@/components/layout/CartProvider";
import { useAuth } from "@/components/layout/AuthProvider";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

function stagioneBadge(stagione: string) {
  if (stagione === "Estive") return <Badge variant="brand">Estive</Badge>;
  if (stagione === "Invernali") return <Badge variant="neutral">Invernali</Badge>;
  return <Badge variant="success">4 Stagioni</Badge>;
}

export default function CarrelloPage() {
  const { user } = useAuth();
  const { items, itemsConSconto, remove, update, totals, totalsConSconto, refreshPromo } = useCart();
  const [showLogisticaPopup, setShowLogisticaPopup] = useState(false);

  // Carica promozioni utente al mount (se non già caricate dal PromoLoader)
  useEffect(() => {
    if (user?.uid) refreshPromo(user.uid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Mostra popup contributo logistico la prima volta (utentiAvvisati)
  useEffect(() => {
    if (!user?.uid || (user as Record<string, unknown>).utentiAvvisati) return;
    setShowLogisticaPopup(true);
  }, [user]);

  async function dismissLogisticaPopup() {
    setShowLogisticaPopup(false);
    if (user?.uid) {
      try {
        await updateDoc(doc(db, "users", user.uid), { utentiAvvisati: true });
      } catch { /* non bloccante */ }
    }
  }

  // Stock check: riduce qty se lo stock è diminuito dal momento dell'aggiunta
  useEffect(() => {
    if (items.length === 0) return;
    (async () => {
      try {
        const res = await fetch("/api/prodotti/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: items.map((i) => i.id) }),
        });
        if (!res.ok) return;
        const { prodotti } = await res.json();
        const byId = new Map((prodotti as Record<string, number>[]).map((p) => [p.id as unknown as string, p]));
        for (const item of items) {
          const d = byId.get(item.id);
          if (!d) continue;
          const currentStock =
            (d.Stock_Nola ?? 0) + (d.Stock_Nola_2 ?? 0) + (d.Stock_Volla ?? 0) +
            (d.Stock_Roma ?? 0) + (d.Stock_Portici ?? 0) + (d.Stock_OCP ?? 0);
          if (currentStock > 0 && item.quantita > currentStock) {
            update(item.id, currentStock);
          }
        }
      } catch { /* ignora */ }
    })();
  // Dipende da items.length (non []): il carrello si idrata da localStorage
  // dopo il primo render (CartProvider parte da items:[]) — con [] questo
  // effetto girava una volta a carrello ancora vuoto e non ripartiva mai più.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const haSconto = totalsConSconto.scontoTotale > 0;

  const logisticaModal = showLogisticaPopup && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 space-y-4"
        style={{ background: "#fff", boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(255,200,3,0.15)" }}>
            <Truck size={20} style={{ color: "var(--brand)" }} />
          </div>
          <h2 className="text-base font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
            Contributo logistico
          </h2>
        </div>
        <p className="text-sm leading-relaxed" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-secondary)" }}>
          Ai prezzi mostrati viene aggiunto un <strong>contributo logistico di € 0,95</strong> per ogni pneumatico, a copertura dei costi di gestione e trasporto.
        </p>
        <p className="text-xs" style={{ fontFamily: "var(--font-montserrat)", color: "var(--text-muted)" }}>
          Questo importo è incluso nel totale del carrello e non verrà addebitato separatamente.
        </p>
        <button
          onClick={dismissLogisticaPopup}
          className="w-full py-3 rounded-full text-sm font-bold transition-opacity hover:opacity-90"
          style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
        >
          Ho capito
        </button>
      </div>
    </div>
  );

  if (items.length === 0) {
    return (
      <>
        {logisticaModal}
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <ShoppingCart size={56} style={{ color: "var(--text-muted)" }} />
          <p
            className="text-lg font-semibold"
            style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}
          >
            Il carrello è vuoto
          </p>
          <Link
            href="/"
            className="px-6 py-2.5 rounded-full text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
          >
            Vai al catalogo
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      {logisticaModal}
    <div className="px-4 md:px-6 py-6 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-4">
          <h1
            className="text-2xl font-bold mb-4"
            style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}
          >
            Carrello ({items.length} articoli)
          </h1>

          {itemsConSconto.map((item) => (
            <Card key={item.id} padding="sm">
              <div className="flex gap-4 relative">
                <button
                  onClick={() => remove(item.id)}
                  className="absolute top-0 right-0 p-1 rounded-full hover:bg-gray-100 transition-colors"
                  style={{ color: "var(--text-muted)" }}
                >
                  <X size={16} />
                </button>

                <div
                  className="flex-shrink-0 w-20 h-20 rounded-xl flex items-center justify-center"
                  style={{ background: "var(--bg-primary)" }}
                >
                  <Package size={28} style={{ color: "var(--text-muted)" }} />
                </div>

                <div className="flex-1 min-w-0 pr-6">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p
                        className="font-bold text-sm"
                        style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}
                      >
                        {item.marca} {item.modello}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className="text-xs"
                          style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
                        >
                          {item.misura}
                        </span>
                        {stagioneBadge(item.stagione)}
                        {item.sconto && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                            style={{ background: "rgba(34,197,94,0.12)", color: "#16a34a" }}
                          >
                            <Percent size={9} />
                            PROMO
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        {item.sconto ? (
                          <>
                            <span
                              className="text-xs line-through"
                              style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
                            >
                              € {item.prezzo.toFixed(2)}
                            </span>
                            <span
                              className="text-sm font-bold"
                              style={{ color: "#16a34a", fontFamily: "var(--font-montserrat)" }}
                            >
                              € {item.prezzoScontato.toFixed(2)}
                            </span>
                          </>
                        ) : (
                          <span
                            className="text-sm font-semibold"
                            style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}
                          >
                            € {item.prezzo.toFixed(2)}
                          </span>
                        )}
                        <span
                          className="text-xs"
                          style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
                        >
                          + PFU € {item.pfu.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (item.quantita <= 1) remove(item.id);
                          else update(item.id, item.quantita - 1);
                        }}
                        className="w-7 h-7 rounded-full border flex items-center justify-center transition-colors hover:bg-gray-50"
                        style={{ border: "1px solid var(--border)" }}
                        title={item.quantita <= 1 ? "Rimuovi dal carrello" : "Diminuisci quantità"}
                      >
                        <Minus size={12} />
                      </button>
                      <span
                        className="w-8 text-center text-sm font-semibold"
                        style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}
                      >
                        {item.quantita}
                      </span>
                      <button
                        onClick={() => update(item.id, item.quantita + 1)}
                        disabled={item.quantita >= item.stockMax}
                        className="w-7 h-7 rounded-full border flex items-center justify-center transition-colors hover:bg-gray-50 disabled:opacity-30"
                        style={{ border: "1px solid var(--border)" }}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <span
                      className="font-bold"
                      style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}
                    >
                      € {(item.prezzoScontato * item.quantita).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="lg:col-span-1">
          <div className="sticky top-6">
            <Card>
              <h2
                className="text-lg font-bold mb-4"
                style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}
              >
                Riepilogo ordine
              </h2>

              <div className="space-y-3">
                <div className="flex justify-between text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Subtotale</span>
                  <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    € {totalsConSconto.subtotale.toFixed(2)}
                  </span>
                </div>

                {haSconto && (
                  <div className="flex justify-between text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                    <span style={{ color: "#16a34a", fontWeight: 600 }}>Sconto promozione</span>
                    <span style={{ color: "#16a34a", fontWeight: 700 }}>
                      - € {totalsConSconto.scontoTotale.toFixed(2)}
                    </span>
                  </div>
                )}

                <div className="flex justify-between text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                  <span style={{ color: "var(--text-secondary)" }}>PFU</span>
                  <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    € {totalsConSconto.pfu.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Contributo logistico</span>
                  <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    € {totalsConSconto.contributoLogistico.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                  <span style={{ color: "var(--text-secondary)" }}>IVA (22%)</span>
                  <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    € {totalsConSconto.iva.toFixed(2)}
                  </span>
                </div>

                <div
                  className="border-t pt-3 flex justify-between"
                  style={{ borderColor: "var(--border)" }}
                >
                  <span
                    className="font-bold"
                    style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}
                  >
                    Totale
                  </span>
                  <span
                    className="font-bold text-lg"
                    style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}
                  >
                    € {totalsConSconto.totale.toFixed(2)}
                  </span>
                </div>
              </div>

              {haSconto ? (
                <div
                  className="mt-4 p-3 rounded-xl flex items-center gap-2 text-sm"
                  style={{ background: "rgba(34,197,94,0.08)", fontFamily: "var(--font-montserrat)" }}
                >
                  <Percent size={14} style={{ color: "#16a34a", flexShrink: 0 }} />
                  <span style={{ color: "#16a34a" }}>
                    Promozione applicata — risparmi € {totalsConSconto.scontoTotale.toFixed(2)}
                  </span>
                </div>
              ) : (
                <div
                  className="mt-4 p-3 rounded-xl flex items-center gap-2 text-sm"
                  style={{ background: "rgba(255,200,3,0.1)", fontFamily: "var(--font-montserrat)" }}
                >
                  <Tag size={14} style={{ color: "var(--brand)", flexShrink: 0 }} />
                  <span style={{ color: "var(--text-secondary)" }}>I prezzi mostrati sono già il tuo prezzo personalizzato</span>
                </div>
              )}

              <div className="mt-5 space-y-3">
                <Link
                  href="/checkout"
                  className="w-full flex items-center justify-center py-3 rounded-full font-semibold text-sm transition-all hover:brightness-[1.04] active:scale-[.99]"
                  style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)", boxShadow: "var(--shadow-brand)" }}
                >
                  Procedi al checkout
                </Link>
                <Link
                  href="/"
                  className="w-full flex items-center justify-center py-2.5 text-sm transition-colors hover:underline"
                  style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
                >
                  Continua gli acquisti
                </Link>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
