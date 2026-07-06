// Ricerca prodotti su MeiliSearch (server-only) per il B2B Spiezia.
// Sostituisce Algolia leggendo l'indice `prodotti` condiviso del gruppo
// (stessa sorgente di prezzo-gomme). Ritorna la stessa forma ProdottoHit;
// lo stripping dei prezzi per ruolo avviene nella route, non qui.
//
// Mappature note (verificate contro i dati reali):
//  · stagione: UI "4 Stagioni" (spazio) ↔ Meili "4-Stagioni" (trattino)
//  · larghezza/altezza/diametro: stringhe in Meili, numeri nel ProdottoHit
//  · disponibilità: has_stock (colonna generata) invece dei 6 campi stock

import { MeiliSearch } from "meilisearch";
import type { ProdottoHit, SearchProdottiParams, SearchProdottiResult } from "./algolia";

let _client: MeiliSearch | null = null;
function getMeili(): MeiliSearch {
  if (!_client) {
    const host = process.env.MEILI_HOST || "http://meilisearch:7700";
    const apiKey = process.env.MEILI_MASTER_KEY || process.env.MEILI_API_KEY || "";
    _client = new MeiliSearch({ host, apiKey });
  }
  return _client;
}

const INDEX = "prodotti";

// ─── Mappature stagione ──────────────────────────────────────────────────────
function stagioneToMeili(s: string): string {
  return s === "4 Stagioni" ? "4-Stagioni" : s;
}
function stagioneFromMeili(s: string | undefined): ProdottoHit["Stagione"] {
  if (s === "4-Stagioni") return "4 Stagioni";
  if (s === "Invernali") return "Invernali";
  return "Estive";
}

function quote(v: string | number): string {
  return `"${String(v).replace(/"/g, '\\"')}"`;
}

type MeiliDoc = Record<string, unknown>;
const num = (v: unknown): number => Number(v) || 0;
const str = (v: unknown): string | undefined => (v == null ? undefined : String(v));

function mapHit(d: MeiliDoc): ProdottoHit {
  return {
    objectID: String(d.id),
    Titolo: str(d.titolo),
    Marca: String(d.marca ?? ""),
    Modello: String(d.modello ?? ""),
    Larghezza: num(d.larghezza),
    Altezza: num(d.altezza),
    Diametro: num(d.diametro),
    Stagione: stagioneFromMeili(d.stagione as string),
    Categoria: str(d.categoria),
    Immagine: str(d.immagine),
    PFU: num(d.pfu),
    T24: Boolean(d.t24),
    Indice_Velocita: str(d.indice_velocita),
    Indice_Carico: str(d.indice_carico),
    Indice_Consumo: str(d.indice_consumo),
    Indice_Bagnato: str(d.indice_bagnato),
    Indice_Rumorosita: str(d.indice_rumorosita),
    EAN: str(d.ean),
    SKU: str(d.sku),
    CAI: str(d.cai),
    Prezzo: num(d.prezzo_privato),
    Prezzo_Gommista: num(d.prezzo_gommista),
    Prezzo_Grossista: num(d.prezzo_grossista),
    Prezzo_Privato: num(d.prezzo_privato),
    Prezzo_T24: num(d.prezzo_t24),
    Prezzo_Acquisto: num(d.prezzo_acquisto),
    Stock_Nola: num(d.stock_nola),
    Stock_Nola_2: num(d.stock_nola_2),
    Stock_Volla: num(d.stock_volla),
    Stock_Roma: num(d.stock_roma),
    Stock_Portici: num(d.stock_portici),
    Stock_OCP: 0, // non presente in Meili
    Stock_T24: num(d.stock_t24),
  };
}

export async function searchProdottiMeili(
  params: SearchProdottiParams = {},
  sort?: string[]
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

  // Vincolo di progetto: SEMPRE e SOLO T24=false (escluso il dropship Tyre24).
  const filters: string[] = ["t24 = false"];
  // Esclude i servizi/accessori (olio, trasporto, valvole…): come su prezzo-gomme
  // il catalogo mostra solo prodotti con prezzo >= 20.
  filters.push("prezzo_effettivo >= 20");
  if (soloDisponibili) filters.push("has_stock = true");
  if (largezza) filters.push(`larghezza = ${quote(largezza)}`);
  if (altezza) filters.push(`altezza = ${quote(altezza)}`);
  if (diametro) filters.push(`diametro = ${quote(diametro)}`);
  if (stagioni.length > 0) {
    filters.push(`(${stagioni.map((s) => `stagione = ${quote(stagioneToMeili(s))}`).join(" OR ")})`);
  }
  if (marche.length > 0) {
    filters.push(`(${marche.map((m) => `marca = ${quote(m)}`).join(" OR ")})`);
  }
  if (categoria) filters.push(`categoria = ${quote(categoria)}`);

  const res = await getMeili().index(INDEX).search(query, {
    filter: filters.join(" AND "),
    page: page + 1, // Meili è 1-indexed
    hitsPerPage,
    sort: sort && sort.length > 0 ? sort : undefined,
    facets: withFacets ? ["marca", "stagione"] : undefined,
  });

  // Meili con page+hitsPerPage ritorna totalHits/totalPages/page
  const r = res as unknown as {
    hits: MeiliDoc[];
    totalHits?: number;
    totalPages?: number;
    facetDistribution?: Record<string, Record<string, number>>;
  };

  let facets: SearchProdottiResult["facets"];
  if (withFacets && r.facetDistribution) {
    facets = {};
    if (r.facetDistribution.marca) facets.Marca = r.facetDistribution.marca;
    if (r.facetDistribution.stagione) {
      // rimappa le chiavi stagione al formato UI (con spazio)
      facets.Stagione = Object.fromEntries(
        Object.entries(r.facetDistribution.stagione).map(([k, v]) => [stagioneFromMeili(k), v])
      );
    }
  }

  return {
    hits: r.hits.map(mapHit),
    nbHits: r.totalHits ?? r.hits.length,
    nbPages: r.totalPages ?? Math.ceil((r.totalHits ?? 0) / hitsPerPage),
    page,
    facets,
  };
}
