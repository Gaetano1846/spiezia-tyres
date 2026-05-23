import { algoliasearch } from "algoliasearch";
import type { Ruolo } from "./types";

export const algoliaClient = algoliasearch(
  process.env.NEXT_PUBLIC_ALGOLIA_APP_ID ?? "",
  process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_KEY ?? ""
);

export const INDEX_NAME = process.env.NEXT_PUBLIC_ALGOLIA_INDEX ?? "Prodotti";

export type ProdottoHit = {
  objectID: string;
  Titolo?: string;
  Marca: string;
  Modello: string;
  Larghezza: number;
  Altezza: number;
  Diametro: number;
  Stagione: "Estive" | "Invernali" | "4-Stagioni";
  Categoria?: string;
  Immagine?: string;
  PFU: number;
  T24: boolean;
  Indice_Velocita?: string;
  Indice_Carico?: string;
  EAN?: string;
  SKU?: string;
  Label?: string;
  CAI?: string;
  Prezzo_Gommista: number;
  Prezzo_Grossista: number;
  Prezzo_Privato: number;
  Prezzo_T24: number;
  Prezzo_Acquisto?: number;
  Stock_Nola: number;
  Stock_Nola_2: number;
  Stock_Volla: number;
  Stock_Roma: number;
  Stock_Portici: number;
  Stock_OCP: number;
  Stock_T24: number;
};

type AlgoliaRaw = {
  hits: unknown[];
  nbHits: number;
  nbPages: number;
  page: number;
  facets?: Record<string, Record<string, number>>;
};

export function prezzoPerRuolo(hit: ProdottoHit, ruolo: Ruolo | undefined): number {
  switch (ruolo) {
    case "Grossista": return Number(hit.Prezzo_Grossista) || 0;
    case "Privato":   return Number(hit.Prezzo_Privato)   || 0;
    case "T24":       return Number(hit.Prezzo_T24)       || 0;
    default:          return Number(hit.Prezzo_Gommista)  || 0;
  }
}

export function stockTotale(hit: ProdottoHit): number {
  return (
    (hit.Stock_Nola ?? 0) +
    (hit.Stock_Nola_2 ?? 0) +
    (hit.Stock_Volla ?? 0) +
    (hit.Stock_Roma ?? 0) +
    (hit.Stock_Portici ?? 0) +
    (hit.Stock_OCP ?? 0)
  );
}

export function formatMisura(hit: ProdottoHit): string {
  return `${hit.Larghezza}/${hit.Altezza} R${hit.Diametro}`;
}

// PFU (Pneumatico Fuori Uso) — contributo ambientale obbligatorio per raggio
// Fonte: tariffe standard EcoTyre/Retyre per autovetture (IVA esclusa)
const PFU_PER_DIAMETRO: [number, number][] = [
  [16, 3.00],
  [18, 4.50],
  [20, 6.00],
  [Infinity, 7.50],
];

export function pfuDaDiametro(diametro: number): number {
  for (const [soglia, valore] of PFU_PER_DIAMETRO) {
    if (diametro <= soglia) return valore;
  }
  return 7.50;
}

// Restituisce il PFU da usare: quello del documento se > 0, altrimenti calcolato
export function pfuEffettivo(hit: Pick<ProdottoHit, "PFU" | "Diametro">): number {
  const stored = Number(hit.PFU);
  return stored > 0 ? stored : pfuDaDiametro(Number(hit.Diametro));
}

export type SearchProdottiParams = {
  query?: string;
  largezza?: number | string;
  altezza?: number | string;
  diametro?: number | string;
  stagioni?: string[];
  marche?: string[];
  categoria?: string;
  soloDisponibili?: boolean;
  page?: number;
  hitsPerPage?: number;
  withFacets?: boolean;
};

export type SearchProdottiResult = {
  hits: ProdottoHit[];
  nbHits: number;
  nbPages: number;
  page: number;
  facets?: Record<string, Record<string, number>>;
};

export async function searchProdotti(
  params: SearchProdottiParams = {}
): Promise<SearchProdottiResult> {
  const {
    query = "",
    largezza,
    altezza,
    diametro,
    stagioni = [],
    marche = [],
    categoria,
    soloDisponibili = true,
    page = 0,
    hitsPerPage = 24,
    withFacets = false,
  } = params;

  const numericFilters: (string | string[])[] = [];

  // Stock filter (OR across depots)
  if (soloDisponibili) {
    numericFilters.push([
      "Stock_Nola>=1",
      "Stock_Nola_2>=1",
      "Stock_Volla>=1",
      "Stock_Roma>=1",
      "Stock_Portici>=1",
      "Stock_OCP>=1",
      "Stock_T24>=16",
    ]);
  }

  const facetFilters: string[][] = [];
  if (stagioni.length > 0) facetFilters.push(stagioni.map((s) => `Stagione:${s}`));
  if (marche.length > 0)   facetFilters.push(marche.map((m) => `Marca:${m}`));
  if (categoria)            facetFilters.push([`Categoria:${categoria}`]);

  const hasSizeFilter = !!(largezza || altezza || diametro);

  // Base search params
  const baseParams = {
    query,
    numericFilters: numericFilters.length > 0 ? numericFilters : undefined,
    facetFilters: facetFilters.length > 0 ? facetFilters : undefined,
    facets: withFacets ? ["Marca", "Stagione"] : undefined,
  };

  if (!hasSizeFilter) {
    // Normal paginated search — Algolia handles everything
    const raw = (await algoliaClient.searchSingleIndex({
      indexName: INDEX_NAME,
      searchParams: { ...baseParams, page, hitsPerPage },
    })) as unknown as AlgoliaRaw;

    return {
      hits: (raw.hits ?? []) as ProdottoHit[],
      nbHits: raw.nbHits ?? 0,
      nbPages: raw.nbPages ?? Math.ceil((raw.nbHits ?? 0) / hitsPerPage),
      page: raw.page ?? 0,
      facets: raw.facets,
    };
  }

  // Size filter active: Larghezza/Altezza/Diametro are not in numericAttributesForFiltering
  // so we fetch up to 4 × 1000 hits in parallel then filter client-side.
  const BULK = 1000; // Algolia max hitsPerPage
  const first = (await algoliaClient.searchSingleIndex({
    indexName: INDEX_NAME,
    searchParams: { ...baseParams, page: 0, hitsPerPage: BULK },
  })) as unknown as AlgoliaRaw;

  let allHits: ProdottoHit[] = (first.hits ?? []) as ProdottoHit[];

  if (first.nbPages > 1) {
    const extraPages = Math.min(first.nbPages - 1, 3); // fetch up to 3 more pages (4000 total)
    const extras = await Promise.all(
      Array.from({ length: extraPages }, (_, i) =>
        algoliaClient.searchSingleIndex({
          indexName: INDEX_NAME,
          searchParams: { ...baseParams, page: i + 1, hitsPerPage: BULK },
        })
      )
    );
    for (const p of extras) {
      allHits = allHits.concat((p as unknown as AlgoliaRaw).hits as ProdottoHit[]);
    }
  }

  // Client-side size filtering (exact numeric match)
  if (largezza) allHits = allHits.filter((h) => Number(h.Larghezza) === Number(largezza));
  if (altezza)  allHits = allHits.filter((h) => Number(h.Altezza)   === Number(altezza));
  if (diametro) allHits = allHits.filter((h) => Number(h.Diametro)  === Number(diametro));

  const totalFiltered = allHits.length;
  const start = page * hitsPerPage;
  const pageHits = allHits.slice(start, start + hitsPerPage);

  return {
    hits: pageHits,
    nbHits: totalFiltered,
    nbPages: Math.ceil(totalFiltered / hitsPerPage),
    page,
    facets: first.facets,
  };
}
