"use client";
import { useEffect } from "react";
import Link from "next/link";
import { Package, Plus, Minus, X, Tag, ShoppingCart } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { useCart } from "@/components/layout/CartProvider";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

type StagioneKey = "Estive" | "Invernali" | "4-Stagioni";

function stagioneBadge(stagione: string) {
  if (stagione === "Estive") return <Badge variant="brand">Estive</Badge>;
  if (stagione === "Invernali") return <Badge variant="neutral">Invernali</Badge>;
  return <Badge variant="success">4 Stagioni</Badge>;
}

export default function CarrelloPage() {
  const { items, remove, update, totals } = useCart();

  // Stock check: trim qty if product stock has decreased since adding to cart
  useEffect(() => {
    if (items.length === 0) return;
    items.forEach(async (item) => {
      try {
        const snap = await getDoc(doc(db, "Prodotti", item.id));
        if (!snap.exists()) return;
        const d = snap.data() as Record<string, number>;
        const currentStock =
          (d.Stock_Nola ?? 0) + (d.Stock_Nola_2 ?? 0) + (d.Stock_Volla ?? 0) +
          (d.Stock_Roma ?? 0) + (d.Stock_Portici ?? 0) + (d.Stock_OCP ?? 0);
        if (currentStock > 0 && item.quantita > currentStock) {
          update(item.id, currentStock);
        }
      } catch { /* ignora */ }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items.length === 0) {
    return (
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
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-4">
          <h1
            className="text-2xl font-bold mb-4"
            style={{ color: "var(--text-primary)", fontFamily: "var(--font-poppins)" }}
          >
            Carrello ({items.length} articoli)
          </h1>

          {items.map((item) => (
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
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className="text-sm font-semibold"
                          style={{ color: "var(--text-primary)", fontFamily: "var(--font-montserrat)" }}
                        >
                          € {item.prezzo.toFixed(2)}
                        </span>
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
                        onClick={() => update(item.id, item.quantita - 1)}
                        disabled={item.quantita <= 1}
                        className="w-7 h-7 rounded-full border flex items-center justify-center transition-colors hover:bg-gray-50 disabled:opacity-30"
                        style={{ border: "1px solid var(--border)" }}
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
                      € {(item.prezzo * item.quantita).toFixed(2)}
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
                  <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>€ {totals.subtotale.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                  <span style={{ color: "var(--text-secondary)" }}>PFU</span>
                  <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>€ {totals.pfu.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Contributo logistico</span>
                  <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>€ {totals.contributoLogistico.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm" style={{ fontFamily: "var(--font-montserrat)" }}>
                  <span style={{ color: "var(--text-secondary)" }}>IVA (22%)</span>
                  <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>€ {totals.iva.toFixed(2)}</span>
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
                    € {totals.totale.toFixed(2)}
                  </span>
                </div>
              </div>

              <div
                className="mt-4 p-3 rounded-xl flex items-center gap-2 text-sm"
                style={{ background: "rgba(255,200,3,0.1)", fontFamily: "var(--font-montserrat)" }}
              >
                <Tag size={14} style={{ color: "var(--brand)", flexShrink: 0 }} />
                <span style={{ color: "var(--text-secondary)" }}>Promozioni applicate automaticamente</span>
              </div>

              <div className="mt-5 space-y-3">
                <Link
                  href="/checkout"
                  className="w-full flex items-center justify-center py-3 rounded-full font-semibold text-sm transition-opacity hover:opacity-90"
                  style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
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
  );
}
