import { algoliasearch } from "algoliasearch";
import type { Ruolo } from "./types";

let _algoliaClient: ReturnType<typeof algoliasearch> | null = null;

function getAlgoliaClient() {
  if (!_algoliaClient) {
    const appId = process.env.NEXT_PUBLIC_ALGOLIA_APP_ID ?? "";
    const key   = process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_KEY ?? "";
    if (!appId || !key) throw new Error("Algolia non configurato: NEXT_PUBLIC_ALGOLIA_APP_ID e NEXT_PUBLIC_ALGOLIA_SEARCH_KEY mancanti.");
    _algoliaClient = algoliasearch(appId, key);
  }
  return _algoliaClient;
}

export const algoliaClient = new Proxy({} as ReturnType<typeof algoliasearch>, {
  get(_t, prop) {
    const client = getAlgoliaClient();
    const value = (client as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});

export const INDEX_NAME = process.env.NEXT_PUBLIC_ALGOLIA_INDEX ?? "Prodotti";

// Indice Algolia degli ordini (stesso usato dal precedente progetto FlutterFlow
// tramite OrdiniRecord.search). Attributi ricercabili configurati sull'indice:
// ID · Indirizzo_Fatturazione.Destinatario · Indirizzo_Spedizione.Destinatario · GLS_TrackingNumber
export const ORDINI_INDEX_NAME = process.env.NEXT_PUBLIC_ALGOLIA_INDEX_ORDINI ?? "Ordini";

export type ProdottoHit = {
  objectID: string;
  Titolo?: string;
  Marca: string;
  Modello: string;
  Larghezza: number;
  Altezza: number;
  Diametro: number;
  Stagione: "Estive" | "Invernali" | "4 Stagioni";
  Categoria?: string;
  Immagine?: string;
  PFU: number;
  T24: boolean;
  Indice_Velocita?: string;
  Indice_Carico?: string;
  Indice_Consumo?: string;
  Indice_Bagnato?: string;
  Indice_Rumorosita?: string;
  EAN?: string;
  SKU?: string;
  Label?: string;
  Foto?: string;
  CAI?: string;
  Prezzo?: number;           // campo generico — usato come ultimo fallback
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

// ─── Ricerca ordini (mirror FlutterFlow: dropdown "Numero Ordine / Nome / Dati
// Spedizione" + campo testo + icona ricerca → OrdiniRecord.search sull'indice
// Algolia "Ordini", su TUTTI gli ordini, indipendentemente dal range di date). ──

export type OrdiniSearchField = "Numero Ordine" | "Nome" | "Dati Spedizione";

// Il campo del dropdown restringe gli attributi ricercabili dell'indice.
// (Nel FF il dropdown era puramente estetico — qui lo rendiamo funzionale
// mantenendo le stesse etichette.)
const ORDINI_SEARCH_ATTRS: Record<OrdiniSearchField, string[]> = {
  "Numero Ordine":   ["ID"],
  "Nome":            ["Indirizzo_Fatturazione.Destinatario", "Indirizzo_Spedizione.Destinatario"],
  "Dati Spedizione": ["Indirizzo_Spedizione.Destinatario", "GLS_TrackingNumber"],
};

// Un hit dell'indice "Ordini". I riferimenti (Cliente/Utente) sono salvati come
// path stringa (Algolia non serializza i DocumentReference); DataOra è in millis.
export type OrdineHit = {
  objectID: string;
  path?: string;
  ID?: string;
  Source?: string;
  Stato?: string;
  Totale?: number;
  DataOra?: number;          // epoch millis
  Cliente?: string;          // path Firestore, es. "Clienti/xxx"
  Utente?: string;           // path Firestore, es. "users/xxx"
  Corriere?: string;
  Indirizzo_Spedizione?: Record<string, unknown>;
  Indirizzo_Fatturazione?: Record<string, unknown>;
  [k: string]: unknown;
};

// Ritorna gli hit dell'indice "Ordini" in ordine di pertinenza Algolia.
export async function searchOrdini(
  term: string,
  field?: OrdiniSearchField,
  hitsPerPage = 50,
): Promise<OrdineHit[]> {
  const q = term.trim();
  if (!q) return [];
  const searchParams: Record<string, unknown> = { query: q, hitsPerPage };
  const attrs = field ? ORDINI_SEARCH_ATTRS[field] : undefined;
  if (attrs) searchParams.restrictSearchableAttributes = attrs;
  const raw = (await algoliaClient.searchSingleIndex({
    indexName: ORDINI_INDEX_NAME,
    searchParams,
  })) as unknown as AlgoliaRaw;
  return (raw.hits ?? []) as OrdineHit[];
}

export function prezzoPerRuolo(hit: ProdottoHit, ruolo: Ruolo | undefined): number {
  // Catena fallback identica a Flutter:
  // 1. Prezzo specifico per ruolo
  // 2. Prezzo_Gommista (default trade)
  // 3. Prezzo (campo generico su Firestore)
  const specifico = (() => {
    switch (ruolo) {
      case "Grossista": return Number(hit.Prezzo_Grossista);
      case "Privato":   return Number(hit.Prezzo_Privato);
      case "T24":       return Number(hit.Prezzo_T24);
      default:          return Number(hit.Prezzo_Gommista);
    }
  })();
  if (specifico > 0) return specifico;
  const gommista = Number(hit.Prezzo_Gommista);
  if (gommista > 0) return gommista;
  return Number(hit.Prezzo) || 0;
}

export function stockTotale(hit: ProdottoHit): number {
  const fisico =
    (hit.Stock_Nola ?? 0) +
    (hit.Stock_Nola_2 ?? 0) +
    (hit.Stock_Volla ?? 0) +
    (hit.Stock_Roma ?? 0) +
    (hit.Stock_Portici ?? 0) +
    (hit.Stock_OCP ?? 0);
  // T24 dropship: includi solo se >= 16 unità minime del canale
  const t24 = (hit.Stock_T24 ?? 0) >= 16 ? hit.Stock_T24 : 0;
  return fisico + t24;
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
  // Migrazione Firebase→PG (Fase 2): con il flag attivo la ricerca passa dalla
  // route server-side che interroga MeiliSearch (indice condiviso del gruppo) e
  // rimuove i prezzi non pertinenti al ruolo. Default = Algolia (nessun cambio).
  if (process.env.NEXT_PUBLIC_PRODOTTI_BACKEND === "meili" && typeof window !== "undefined") {
    const res = await fetch("/api/prodotti/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`ricerca prodotti (meili) fallita: ${res.status}`);
    return (await res.json()) as SearchProdottiResult;
  }

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

  const filterParts: string[] = [];

  // Vincolo di progetto: si considerano SEMPRE e SOLO i prodotti con T24=false
  // (si esclude il catalogo dropship Tyres24/T24, ~114k articoli). Applicato qui
  // alla sorgente così ogni consumatore (catalogo B2B, admin, magazzino,
  // promozioni, ricerca header) lo eredita automaticamente.
  filterParts.push("T24:false");

  if (soloDisponibili) {
    filterParts.push(
      "(Stock_Nola>=1 OR Stock_Nola_2>=1 OR Stock_Volla>=1 OR Stock_Roma>=1 OR Stock_Portici>=1 OR Stock_OCP>=1)"
    );
  }

  // Filtri numerici esatti su Larghezza/Altezza/Diametro (ora in numericAttributesForFiltering)
  if (largezza) filterParts.push(`Larghezza=${largezza}`);
  if (altezza)  filterParts.push(`Altezza=${altezza}`);
  if (diametro) filterParts.push(`Diametro=${diametro}`);

  const facetFilters: string[][] = [];
  if (stagioni.length > 0) facetFilters.push(stagioni.map((s) => `Stagione:${s}`));
  if (marche.length > 0)   facetFilters.push(marche.map((m) => `Marca:${m}`));
  if (categoria)            facetFilters.push([`Categoria:${categoria}`]);

  const searchParams: Record<string, unknown> = {
    query,
    page,
    hitsPerPage,
  };
  if (filterParts.length > 0)  searchParams.filters      = filterParts.join(" AND ");
  if (facetFilters.length > 0) searchParams.facetFilters = facetFilters;
  if (withFacets)              searchParams.facets        = ["Marca", "Stagione"];

  const raw = (await algoliaClient.searchSingleIndex({
    indexName: INDEX_NAME,
    searchParams,
  })) as unknown as AlgoliaRaw;

  return {
    hits: (raw.hits ?? []) as ProdottoHit[],
    nbHits: raw.nbHits ?? 0,
    nbPages: raw.nbPages ?? Math.ceil((raw.nbHits ?? 0) / hitsPerPage),
    page: raw.page ?? 0,
    facets: raw.facets,
  };
}
