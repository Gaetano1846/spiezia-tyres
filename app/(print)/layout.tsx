import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

/**
 * Gate di sessione per le pagine di stampa.
 * Il gruppo (print) non aveva un layout: le sue pagine (es. stampa ordine)
 * leggono dati sensibili da Firestore e si appoggiavano solo alle regole.
 * Qui imponiamo almeno l'autenticazione lato server; la proprietà del dato
 * (proprio ordine / admin / CRM) resta garantita dalle Firestore rules.
 */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return <>{children}</>;
}
