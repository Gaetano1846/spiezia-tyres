export type CartItem = {
  id: string;
  marca: string;
  modello: string;
  misura: string;
  stagione: string;
  prezzo: number;
  pfu: number;
  quantita: number;
  stockMax: number;
};

const CART_KEY = "spiezia_cart";

export function getCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function saveCart(items: CartItem[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CART_KEY, JSON.stringify(items));
}

export function addToCart(
  item: Omit<CartItem, "quantita"> & { quantita?: number }
): CartItem[] {
  const items = getCart();
  const qty = item.quantita ?? 1;
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx !== -1) {
    items[idx] = {
      ...items[idx],
      quantita: Math.min(items[idx].quantita + qty, items[idx].stockMax),
    };
  } else {
    items.push({ ...item, quantita: Math.min(qty, item.stockMax) });
  }
  saveCart(items);
  return items;
}

export function removeFromCart(id: string): CartItem[] {
  const items = getCart().filter((i) => i.id !== id);
  saveCart(items);
  return items;
}

export function updateQty(id: string, qty: number): CartItem[] {
  const items = getCart().map((i) =>
    i.id === id
      ? { ...i, quantita: Math.max(1, Math.min(qty, i.stockMax)) }
      : i
  );
  saveCart(items);
  return items;
}

export function clearCart(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CART_KEY);
}

export function getCartCount(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.quantita, 0);
}

export const CONTRIBUTO_LOGISTICO_UNIT = 0.95;

export function getCartTotal(items: CartItem[]): {
  subtotale: number;
  pfu: number;
  contributoLogistico: number;
  iva: number;
  totale: number;
} {
  const subtotale = items.reduce((sum, i) => sum + i.prezzo * i.quantita, 0);
  const pfu = items.reduce((sum, i) => sum + i.pfu * i.quantita, 0);
  const totalePneumatici = items.reduce((sum, i) => sum + i.quantita, 0);
  const contributoLogistico = totalePneumatici * CONTRIBUTO_LOGISTICO_UNIT;
  const base = subtotale + pfu + contributoLogistico;
  const iva = base * 0.22;
  const totale = base * 1.22;
  return { subtotale, pfu, contributoLogistico, iva, totale };
}
