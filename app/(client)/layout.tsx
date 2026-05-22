import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import B2BShell from "@/components/layout/B2BShell";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return <B2BShell>{children}</B2BShell>;
}
