import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import ScrollToTop from "@/components/ui/ScrollToTop";

type Props = { children: React.ReactNode; title?: string };

export default function AppShell({ children, title }: Props) {
  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg-primary)" }}>
      <Sidebar />
      <div className="flex-1 flex flex-col" style={{ marginLeft: "240px" }}>
        <TopBar title={title} />
        <main className="flex-1 p-6">{children}</main>
      </div>
      <ScrollToTop />
    </div>
  );
}
