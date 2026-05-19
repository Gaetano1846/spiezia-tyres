import type { Metadata } from "next";

export const metadata: Metadata = { title: "Magazzino" };

export default function MagazzinoPage() {
  return (
    <div>
      <h1 className="text-2xl font-black text-[#111] mb-6">Magazzino</h1>
      <p className="text-[#9DA5AE]">Gestione gabbie e scanner — in sviluppo (Fase 5)</p>
    </div>
  );
}
