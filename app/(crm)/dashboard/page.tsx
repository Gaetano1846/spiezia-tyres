import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard CRM" };

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-black text-[#111] mb-6">Dashboard</h1>
      <p className="text-[#9DA5AE]">KPI officina — in sviluppo (Fase 4)</p>
    </div>
  );
}
