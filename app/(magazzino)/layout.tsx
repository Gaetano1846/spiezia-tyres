import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import B2BShell from "@/components/layout/B2BShell";

export default async function MagazzinoLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const ruolo = session.Ruolo?.toLowerCase() ?? "";
  if (ruolo !== "admin" && ruolo !== "magazziniere") redirect("/");
  return <B2BShell>{children}</B2BShell>;
}
