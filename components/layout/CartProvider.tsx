"use client";
import { createContext, useContext, useState, useEffect } from "react";
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

type CartContextType = {
  items: CartItem[];
  count: number;
  totals: ReturnType<typeof getCartTotal>;
  add: (item: Omit<CartItem, "quantita"> & { quantita?: number }) => void;
  remove: (id: string) => void;
  update: (id: string, qty: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextType>({
  items: [],
  count: 0,
  totals: { subtotale: 0, pfu: 0, contributoLogistico: 0, iva: 0, totale: 0 },
  add: () => {},
  remove: () => {},
  update: () => {},
  clear: () => {},
});

export function useCart(): CartContextType {
  return useContext(CartContext);
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    setItems(getCart());
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

  return (
    <CartContext.Provider value={{ items, count, totals, add, remove, update, clear }}>
      {children}
    </CartContext.Provider>
  );
}
