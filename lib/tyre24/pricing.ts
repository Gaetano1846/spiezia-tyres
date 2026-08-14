// Funzioni pure per l'analisi prezzi Tyre24 sui prodotti REALMENTE nostri
// (public.prodotti WHERE t24=false — t24=true è il catalogo esterno Tyre24
// mirrorato per riferimento, non prodotti nostri, vedi lib/tyre24/analisiDb.ts).
// Nessun I/O qui: porting della logica dello script Python "Tyre24 Price
// Analyzer" rifinita il 2026-07-21 — prezzo suggerito competitor-relative
// (non più cost-plus), /distributorList (a pagamento) chiamata solo quando
// siamo già noi i più economici (per capire se possiamo alzare il prezzo
// restando sotto il 2° classificato). buildRanking ora INCLUDE noi stessi
// nella classifica (prima veniva esclusa self, vedi commento storico su
// NOSTRO_NOME più sotto) così si può calcolare la nostra posizione reale.

export interface Tyre24PriceListEntry {
  type: string;
  value: number;
}

export interface Tyre24SearchTyreEntry {
  idT24?: number;
  ean?: string;
  quantity?: number;
  priceList?: Tyre24PriceListEntry[];
}

export interface Tyre24SearchResponse {
  tyreList?: Tyre24SearchTyreEntry[];
}

/** Estrae il prezzo "ek" (purchase price) dal primo risultato di /search —
 *  stima economica del prezzo più basso trovato (1 sola chiamata, dato lo
 *  stesso minStock di /distributorList). */
export function extractEk(resp: Tyre24SearchResponse | null): number | null {
  const entry = resp?.tyreList?.[0];
  const ek = entry?.priceList?.find((p) => p.type === "ek");
  return ek ? Number(ek.value) : null;
}

export function extractIdT24(resp: Tyre24SearchResponse | null): number | null {
  return resp?.tyreList?.[0]?.idT24 ?? null;
}

export interface NeedsLevel2Input {
  /** Nostro prezzo di VENDITA attuale per il mercato selezionato (NON il
   *  costo di acquisto — quello serve solo al PAV, vedi computePav). */
  prezzoAttuale: number | null;
  ekStimato: number | null;
  sogliaPct: number; // es. 0.05 = 5%
}

/** Decide se serve la chiamata costosa /distributorList. Porting esatto
 *  della logica Python: se il competitor stimato costa MENO di noi, la
 *  stima gratuita di /search basta già per calcolare differenza e nuovo
 *  prezzo suggerito — non serve pagare (si perderebbe solo il nome del
 *  competitor e la posizione esatta, non necessari per il prezzo). Nessun
 *  prezzo di riferimento (null/0) o nessuna stima trovata: idem al Python.
 *
 *  Quando NON siamo battuti, /search (livello 1, gratis) ha trovato come
 *  "offerta più economica" quasi certamente NOI STESSI — quindi ekStimato
 *  finisce vicino/uguale al nostro prezzoAttuale (delta piccolo). Questo
 *  è esattamente il caso "siamo già i più economici" segnalato in
 *  produzione il 2026-08-14: se lo scarto è piccolo (entro sogliaPct) NON
 *  significa "va bene così", significa che /search non ci dice nulla sul
 *  2° classificato — dobbiamo pagare /distributorList per scoprire se c'è
 *  margine per alzare il prezzo. Se invece lo scarto è grande (ekStimato
 *  notevolmente sopra il nostro prezzo — tipicamente segno che la nostra
 *  offerta non è visibile su Tyre24, es. stock/minStock), non è un segnale
 *  affidabile di "siamo primi": si resta prudenti e si evita la spesa,
 *  usando la stima com'è (vedi suggestPriceFromEk). */
export function needsLevel2({ prezzoAttuale, ekStimato, sogliaPct }: NeedsLevel2Input): boolean {
  if (ekStimato == null) return false;
  if (prezzoAttuale == null || prezzoAttuale === 0) return true;
  if (ekStimato < prezzoAttuale) return false;
  const delta = Math.abs(ekStimato - prezzoAttuale) / prezzoAttuale;
  return delta <= sogliaPct;
}

export interface Tyre24Distributor {
  name?: string;
  stock?: number;
  priceList?: Tyre24PriceListEntry[];
}

export interface RankedDistributor {
  name: string;
  stock: number;
  price: number;
}

// Siamo anche noi registrati come distributore su Tyre24 (confermato da un
// caso reale in produzione: "SPIEZIA TYRES S.P.A." è risultato il "miglior
// distributore" trovato per un prodotto). In precedenza questo nome veniva
// ESCLUSO dalla classifica per evitare di suggerire un prezzo basato su noi
// stessi — fix corretto ma incompleto: perdeva la possibilità di sapere la
// nostra posizione reale. La nuova buildRanking include noi stessi e lascia
// che sia suggestPrice() a gestire il caso "siamo primi" (usa il 2°
// classificato invece del nostro stesso prezzo) — porting fedele di
// build_ranking()+nostra_pos dello script Python.
const NOSTRO_NOME = "spiezia tyres";

export interface BuildRankingResult {
  ranking: RankedDistributor[];
  best: RankedDistributor | null;
  second: RankedDistributor | null;
  /** 1-indexed nella classifica finale (dopo eventuale filtro stock); null
   *  se non ci troviamo nella lista (equivalente a "ASSENTI" nel Python). */
  nostraPos: number | null;
  nostroStock: number | null;
}

/** Estrae ek+stock per ogni distributore (noi COMPRESI) e ordina per prezzo
 *  crescente, preferendo chi rispetta minStock (fallback alla lista intera
 *  se nessuno lo rispetta) — porting di build_ranking() dello script
 *  Python. Calcola anche la nostra posizione/stock cercando il primo nome
 *  che combacia con NOSTRO_NOME nella classifica risultante. */
export function buildRanking(
  distributors: Tyre24Distributor[] | null | undefined,
  minStock: number
): BuildRankingResult {
  const cleaned: RankedDistributor[] = [];
  for (const d of distributors ?? []) {
    const name = (d.name ?? "").trim();
    const ekEntry = d.priceList?.find((p) => p.type === "ek");
    if (!ekEntry) continue;
    cleaned.push({ name, stock: d.stock ?? 0, price: Number(ekEntry.value) });
  }
  cleaned.sort((a, b) => a.price - b.price);
  const withStock = cleaned.filter((d) => d.stock >= minStock);
  const ranking = withStock.length > 0 ? withStock : cleaned;
  const best = ranking[0] ?? null;
  const second = ranking[1] ?? null;

  let nostraPos: number | null = null;
  let nostroStock: number | null = null;
  for (let i = 0; i < ranking.length; i++) {
    if (ranking[i].name.toLowerCase().includes(NOSTRO_NOME)) {
      nostraPos = i + 1;
      nostroStock = ranking[i].stock;
      break;
    }
  }

  return { ranking, best, second, nostraPos, nostroStock };
}

export interface ComputePavInput {
  /** Sempre il costo d'acquisto (prezzo_acquisto) — mai la stima/verifica
   *  Tyre24. Il PAV è un floor di sicurezza indipendente dal competitor. */
  costo: number;
  /** Importo fisso in € (es. 3 gestione + 3 utili = 6), non percentuale. */
  margineFisso: number;
  /** Importo fisso in € (es. 4 Italia, 7 estero), non percentuale. */
  spedizione: number;
  /** Commissione Tyre24, es. 0.015 = 1,5%. */
  commissionePct: number;
}

/** Prezzo pavimento (floor di sicurezza) — stessa formula dello script
 *  Python: (costo + margine_fisso + spedizione) * (1 + commissione). Non è
 *  più la base del prezzo suggerito: resta come colonna di controllo a
 *  parte ("Differenza suggerito/PAV"). */
export function computePav({ costo, margineFisso, spedizione, commissionePct }: ComputePavInput): number {
  return round2((costo + margineFisso + spedizione) * (1 + commissionePct));
}

export interface SuggestPriceInput {
  /** Posizione nostra nella classifica completa (vedi buildRanking). */
  nostraPos: number | null;
  best: RankedDistributor | null;
  second: RankedDistributor | null;
  /** Quanto scendere sotto il concorrente (o quanto scendere dalla stima,
   *  vedi suggestPriceFromEk) — stesso campo "pricing advantage" della GUI
   *  Python. */
  pricingAdvantage: number;
}

/** Prezzo di vendita suggerito, competitor-relative — porting esatto della
 *  logica Python: se siamo già primi, usa il 2° classificato - vantaggio
 *  (non ha senso undercuttare noi stessi); altrimenti usa il 1° - vantaggio.
 *  Se non c'è nessun distributore valido (best=null), nessun suggerimento
 *  possibile da qui — il chiamante userà suggestPriceFromEk come fallback. */
export function suggestPrice({ nostraPos, best, second, pricingAdvantage }: SuggestPriceInput): number | null {
  if (!best) return null;
  if (nostraPos === 1) {
    return round2(second ? second.price - pricingAdvantage : best.price);
  }
  return round2(best.price - pricingAdvantage);
}

export interface SuggestPriceFromEkInput {
  ekStimato: number | null;
  pricingAdvantage: number;
}

/** Prezzo suggerito quando NON si è pagata la verifica di livello 2 (siamo
 *  battuti dalla stima gratuita di /search, needsLevel2 ha già deciso che
 *  non vale la pena verificare oltre): prezzo stimato - vantaggio, senza
 *  conoscere nome/posizione del competitor. */
export function suggestPriceFromEk({ ekStimato, pricingAdvantage }: SuggestPriceFromEkInput): number | null {
  return ekStimato == null ? null : round2(ekStimato - pricingAdvantage);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
