import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatEuro(amount: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(amount);
}

export function formatDate(date: Date | { toDate(): Date } | null | undefined): string {
  if (!date) return "—";
  const d = typeof (date as { toDate?(): Date }).toDate === "function"
    ? (date as { toDate(): Date }).toDate()
    : (date as Date);
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export function formatDateTime(date: Date | { toDate(): Date } | null | undefined): string {
  if (!date) return "—";
  const d = typeof (date as { toDate?(): Date }).toDate === "function"
    ? (date as { toDate(): Date }).toDate()
    : (date as Date);
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}
