import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/layout/AppShell";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
