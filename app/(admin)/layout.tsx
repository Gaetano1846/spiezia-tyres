import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import B2BShell from "@/components/layout/B2BShell";
import BackendTabs from "@/components/layout/BackendTabs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.Ruolo?.toLowerCase() !== "admin") redirect("/");
  return (
    <B2BShell>
      <BackendTabs />
      <div className="px-4 md:px-6 py-4">
        {children}
      </div>
    </B2BShell>
  );
}
