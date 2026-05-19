import type { Metadata } from "next";

export const metadata: Metadata = { title: "Ordini" };

export default function OrdiniPage() {
  return (
    <div>
      <h1 className="text-2xl font-black text-[#111] mb-6">Ordini</h1>
      <p className="text-[#9DA5AE]">Gestione ordini multi-canale — in sviluppo (Fase 3)</p>
    </div>
  );
}
