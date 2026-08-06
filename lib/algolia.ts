import type { Ruolo } from "./types";
import { speedConstructionPrefix } from "./titoloExtra";

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
  // Misure autocarro/agricole senza rapporto d'aspetto (es. "13 R22.5"):
  // Altezza arriva 0 da Meili (stringa vuota → Number("")||0), niente "/0".
  // Il prefisso R/ZR va letto dal Titolo: nessuna colonna dedicata lo distingue.
  const r = speedConstructionPrefix(hit.Titolo, hit.Diametro);
  return hit.Altezza ? `${hit.Larghezza}/${hit.Altezza} ${r}${hit.Diametro}` : `${hit.Larghezza} ${r}${hit.Diametro}`;
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

// Categorie non soggette a PFU: camere d'aria e cerchi non sono pneumatici,
// pur avendo un Diametro valorizzato che farebbe scattare il fallback sotto.
function categoriaEsenteDaPfu(categoria: string | undefined): boolean {
  if (!categoria) return false;
  return categoria.includes("Cerchi") || categoria.includes("Camere");
}

// Marche di gomme ricoperte — esenti dal contributo PFU (già assolto sul
// pneumatico originale prima della ricostruzione, fonte EcoTyre/Retyre).
const MARCHE_RICOPERTE = new Set(["vipal", "malatesta", "corgom"]);

function marcaEsenteDaPfu(marca: string | undefined): boolean {
  return !!marca && MARCHE_RICOPERTE.has(marca.trim().toLowerCase());
}

// Restituisce il PFU da usare: 0 per categorie esenti (Cerchi, Camere D'Aria)
// e per marche di gomme ricoperte; altrimenti quello del documento se > 0,
// o calcolato dal diametro.
export function pfuEffettivo(hit: Pick<ProdottoHit, "PFU" | "Diametro" | "Categoria" | "Marca">): number {
  if (categoriaEsenteDaPfu(hit.Categoria) || marcaEsenteDaPfu(hit.Marca)) return 0;
  const stored = Number(hit.PFU);
  return stored > 0 ? stored : pfuDaDiametro(Number(hit.Diametro));
}

export type SearchProdottiParams = {
  query?: string;
  /** Match esatto per EAN (scanner/barcode, app magazzino) — bypassa i filtri
   *  di disponibilità/prezzo/categoria: uno scan deve trovare il prodotto
   *  anche se è a stock zero o è un accessorio, non solo pneumatici in vendita. */
  ean?: string;
  largezza?: number | string;
  altezza?: number | string;
  diametro?: number | string;
  stagioni?: string[];
  marche?: string[];
  indiceVelocita?: string;
  indiceCarico?: string;
  categoria?: string;
  soloDisponibili?: boolean;
  page?: number;
  hitsPerPage?: number;
  withFacets?: boolean;
  // Ordinamento per prezzo lato server (solo backend Meili). Default = "asc":
  // i prodotti sono ordinati per prezzo crescente su TUTTE le pagine.
  sortPrezzo?: "asc" | "desc";
  // Ordinamento per misura (larghezza/altezza/diametro) lato server — quando
  // true ha precedenza su sortPrezzo. Anche questo su TUTTE le pagine, non
  // solo quella corrente (prima era un sort client-side sulla sola pagina
  // caricata — bug segnalato dall'utente, 2026-08-06).
  sortMisura?: boolean;
};

export type SearchProdottiResult = {
  hits: ProdottoHit[];
  nbHits: number;
  nbPages: number;
  page: number;
  facets?: Record<string, Record<string, number>>;
};

// Ricerca prodotti: passa sempre dalla route server-side che interroga
// MeiliSearch (indice condiviso del gruppo) e rimuove i prezzi non pertinenti
// al ruolo — Algolia è stato dismesso, questa è l'unica via di ricerca prodotti.
export async function searchProdotti(
  params: SearchProdottiParams = {}
): Promise<SearchProdottiResult> {
  const res = await fetch("/api/prodotti/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`ricerca prodotti fallita: ${res.status}`);
  return (await res.json()) as SearchProdottiResult;
}
