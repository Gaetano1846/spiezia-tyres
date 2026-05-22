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

  // Stock filter via numericFilters (array format = what Flutter uses, avoids 400)
  // Larghezza/Altezza/Diametro are NOT configured as filterable in the Algolia index —
  // they are returned in the hit payload and filtered client-side instead.
  const numericFilters: (string | string[])[] = [];
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

  // Fetch more hits when size filters are active so client-side filtering has enough results
  const hasSizeFilter = !!(largezza || altezza || diametro);
  const effectiveHitsPerPage = hasSizeFilter ? Math.max(hitsPerPage * 5, 200) : hitsPerPage;

  const raw = (await algoliaClient.searchSingleIndex({
    indexName: INDEX_NAME,
    searchParams: {
      query,
      numericFilters: numericFilters.length > 0 ? numericFilters : undefined,
      facetFilters: facetFilters.length > 0 ? facetFilters : undefined,
      facets: withFacets ? ["Marca", "Stagione"] : undefined,
      page: hasSizeFilter ? 0 : page,
      hitsPerPage: effectiveHitsPerPage,
    },
  })) as unknown as AlgoliaRaw;

  let hits = (raw.hits ?? []) as ProdottoHit[];

  // Client-side size filtering (Larghezza/Altezza/Diametro not filterable in Algolia index)
  if (largezza) hits = hits.filter((h) => h.Larghezza === Number(largezza));
  if (altezza)  hits = hits.filter((h) => h.Altezza  === Number(altezza));
  if (diametro) hits = hits.filter((h) => h.Diametro === Number(diametro));

  // When size-filtering we re-page the client-side filtered results
  const totalFiltered = hits.length;
  if (hasSizeFilter) {
    const start = page * hitsPerPage;
    hits = hits.slice(start, start + hitsPerPage);
  }

  return {
    hits,
    nbHits: hasSizeFilter ? totalFiltered : (raw.nbHits ?? 0),
    nbPages: hasSizeFilter
      ? Math.ceil(totalFiltered / hitsPerPage)
      : (raw.nbPages ?? Math.ceil((raw.nbHits ?? 0) / hitsPerPage)),
    page: raw.page ?? 0,
    facets: raw.facets,
  };
}
