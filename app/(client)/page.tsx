import type { Metadata } from "next";

export const metadata: Metadata = { title: "Catalogo Pneumatici" };

export default function CatalogPage() {
  return (
    <div>
      <h1 className="text-2xl font-black text-[#111] mb-6">Catalogo Pneumatici</h1>
      <p className="text-[#9DA5AE]">Ricerca prodotti — in sviluppo (Fase 2)</p>
    </div>
  );
}
