import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import CrmShell from "@/components/layout/CrmShell";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const ruolo = session.Ruolo?.toLowerCase() ?? "";
  if (!session.CRM && ruolo !== "admin") redirect("/");
  return <CrmShell>{children}</CrmShell>;
}
