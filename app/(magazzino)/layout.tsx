import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/layout/AppShell";

export default async function MagazzinoLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.Ruolo !== "Admin" && session.Ruolo !== "Magazziniere") redirect("/");
  return <AppShell>{children}</AppShell>;
}
