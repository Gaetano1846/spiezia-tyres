"use client";
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  CartItem,
  getCart,
  addToCart,
  removeFromCart,
  updateQty,
  clearCart,
  getCartCount,
  getCartTotal,
} from "@/lib/cart";
import {
  fetchPromozioniUtente,
  applicaPromozione,
  calcolaTotaliConSconto,
  type CartTotalsConSconto,
  type ScontoApplicato,
} from "@/lib/promozioni";
import type { Promozione } from "@/lib/types";

export type CartItemConSconto = CartItem & {
  prezzoScontato: number;
  sconto: ScontoApplicato | null;
};

type CartContextType = {
  items: CartItem[];
  itemsConSconto: CartItemConSconto[];
  count: number;
  totals: ReturnType<typeof getCartTotal>;
  totalsConSconto: CartTotalsConSconto;
  promozioni: Promozione[];
  add: (item: Omit<CartItem, "quantita"> & { quantita?: number }) => void;
  remove: (id: string) => void;
  update: (id: string, qty: number) => void;
  clear: () => void;
  refreshPromo: (uid: string) => Promise<void>;
};

const CartContext = createContext<CartContextType>({
  items: [],
  itemsConSconto: [],
  count: 0,
  totals: { subtotale: 0, pfu: 0, contributoLogistico: 0, iva: 0, totale: 0 },
  totalsConSconto: {
    subtotale: 0, scontoTotale: 0, subtotaleScontato: 0,
    pfu: 0, contributoLogistico: 0, iva: 0, totale: 0,
  },
  promozioni: [],
  add: () => {},
  remove: () => {},
  update: () => {},
  clear: () => {},
  refreshPromo: async () => {},
});

export function useCart(): CartContextType {
  return useContext(CartContext);
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [promozioni, setPromozioni] = useState<Promozione[]>([]);

  useEffect(() => {
    setItems(getCart());
  }, []);

  const refreshPromo = useCallback(async (uid: string) => {
    const promos = await fetchPromozioniUtente(uid);
    setPromozioni(promos);
  }, []);

  function add(item: Omit<CartItem, "quantita"> & { quantita?: number }) {
    setItems(addToCart(item));
  }

  function remove(id: string) {
    setItems(removeFromCart(id));
  }

  function update(id: string, qty: number) {
    setItems(updateQty(id, qty));
  }

  function clear() {
    clearCart();
    setItems([]);
  }

  const count = getCartCount(items);
  const totals = getCartTotal(items);

  // Arricchisce ogni articolo con il prezzo scontato dalla promozione applicata
  const itemsConSconto: CartItemConSconto[] = items.map((item) => {
    const { prezzoScontato, sconto } = applicaPromozione(item, promozioni);
    return { ...item, prezzoScontato, sconto };
  });

  const totalsConSconto = calcolaTotaliConSconto(items, promozioni);

  return (
    <CartContext.Provider
      value={{
        items,
        itemsConSconto,
        count,
        totals,
        totalsConSconto,
        promozioni,
        add,
        remove,
        update,
        clear,
        refreshPromo,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}
