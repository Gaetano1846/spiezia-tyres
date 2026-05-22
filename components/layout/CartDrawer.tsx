"use client";
import Link from "next/link";
import { X, Trash2, Plus, Minus, ShoppingCart } from "lucide-react";
import { useCart } from "@/components/layout/CartProvider";

const CONTRIBUTO_LOGISTICO_UNIT = 0.95;

type Props = {
  open: boolean;
  onClose: () => void;
};

function fmt(n: number) {
  return n.toFixed(2).replace(".", ",") + " €";
}

export default function CartDrawer({ open, onClose }: Props) {
  const { items, totals, remove, update } = useCart();

  const contributoLogistico = items.reduce((sum, i) => sum + i.quantita * CONTRIBUTO_LOGISTICO_UNIT, 0);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <aside
        className="fixed inset-y-0 right-0 z-50 flex flex-col"
        style={{
          width: 380,
          maxWidth: "100vw",
          background: "#fff",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.25s cubic-bezier(.4,0,.2,1)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ background: "#FFC803" }}
        >
          <div className="flex items-center gap-2">
            <ShoppingCart size={20} style={{ color: "#111" }} />
            <span className="font-black text-base uppercase tracking-wide" style={{ color: "#111", fontFamily: "var(--font-montserrat)" }}>
              Il tuo Carrello
            </span>
            {items.length > 0 && (
              <span
                className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                style={{ background: "#111", color: "#FFC803" }}
              >
                {items.reduce((s, i) => s + i.quantita, 0)}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-black/10 transition-colors"
            aria-label="Chiudi carrello"
          >
            <X size={18} style={{ color: "#111" }} />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center" style={{ color: "#9ca3af" }}>
              <ShoppingCart size={48} strokeWidth={1} />
              <p className="text-sm font-medium" style={{ fontFamily: "var(--font-montserrat)" }}>
                Il carrello è vuoto
              </p>
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex gap-3 p-3 rounded-xl"
                style={{ border: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)" }}
              >
                {/* Info prodotto */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold uppercase truncate" style={{ color: "#111" }}>
                    {item.marca}
                  </p>
                  <p className="text-xs font-semibold truncate" style={{ color: "#374151" }}>
                    {item.modello}
                  </p>
                  <p className="text-xs" style={{ color: "#6b7280" }}>
                    {item.misura}
                    {item.stagione && (
                      <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: "#FFF8DC", color: "#111" }}>
                        {item.stagione}
                      </span>
                    )}
                  </p>
                  {/* Prezzo singolo */}
                  <p className="text-xs font-semibold mt-1" style={{ color: "#111" }}>
                    {fmt(item.prezzo)} <span style={{ color: "#9ca3af" }}>+ PFU {fmt(item.pfu)}</span>
                  </p>
                </div>

                {/* Qty + remove */}
                <div className="flex flex-col items-end justify-between gap-2">
                  <button
                    onClick={() => remove(item.id)}
                    className="p-1 rounded hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={14} style={{ color: "#ef4444" }} />
                  </button>

                  <div
                    className="flex items-center rounded-lg overflow-hidden"
                    style={{ border: "1px solid #e5e7eb" }}
                  >
                    <button
                      onClick={() => update(item.id, item.quantita - 1)}
                      disabled={item.quantita <= 1}
                      className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 transition-colors disabled:opacity-40"
                    >
                      <Minus size={12} />
                    </button>
                    <span className="w-7 text-center text-xs font-bold" style={{ color: "#111" }}>
                      {item.quantita}
                    </span>
                    <button
                      onClick={() => update(item.id, item.quantita + 1)}
                      disabled={item.quantita >= item.stockMax}
                      className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 transition-colors disabled:opacity-40"
                    >
                      <Plus size={12} />
                    </button>
                  </div>

                  {/* Totale riga */}
                  <p className="text-xs font-black" style={{ color: "#111" }}>
                    {fmt((item.prezzo + item.pfu) * item.quantita * 1.22)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer totali + CTA */}
        {items.length > 0 && (
          <div
            className="px-5 py-4 space-y-2"
            style={{ borderTop: "1px solid #e5e7eb", fontFamily: "var(--font-montserrat)" }}
          >
            <div className="flex justify-between text-xs" style={{ color: "#6b7280" }}>
              <span>Subtotale</span>
              <span>{fmt(totals.subtotale)}</span>
            </div>
            <div className="flex justify-between text-xs" style={{ color: "#6b7280" }}>
              <span>PFU</span>
              <span>{fmt(totals.pfu)}</span>
            </div>
            <div className="flex justify-between text-xs" style={{ color: "#6b7280" }}>
              <span>Contributo Logistico</span>
              <span>{fmt(contributoLogistico)}</span>
            </div>
            <div className="flex justify-between text-xs" style={{ color: "#6b7280" }}>
              <span>IVA (22%)</span>
              <span>{fmt(totals.iva)}</span>
            </div>
            <div
              className="flex justify-between text-sm font-black pt-2"
              style={{ borderTop: "1px solid #e5e7eb", color: "#111" }}
            >
              <span>Totale</span>
              <span>{fmt(totals.totale + contributoLogistico)}</span>
            </div>

            <Link
              href="/checkout"
              onClick={onClose}
              className="block w-full text-center py-3.5 rounded-xl font-black text-sm uppercase tracking-wide mt-3 transition-opacity hover:opacity-90"
              style={{ background: "#FFC803", color: "#111", fontFamily: "var(--font-montserrat)" }}
            >
              Procedi al Checkout
            </Link>
          </div>
        )}
      </aside>
    </>
  );
}
