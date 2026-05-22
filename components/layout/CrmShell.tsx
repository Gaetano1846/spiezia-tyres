import CrmSidebar from "@/components/layout/CrmSidebar";

export default function CrmShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg-primary)" }}>
      <CrmSidebar />
      <main className="flex-1 p-6 overflow-auto" style={{ marginLeft: "260px" }}>
        {children}
      </main>
    </div>
  );
}
