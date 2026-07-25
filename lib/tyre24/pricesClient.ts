// Client HTTP per l'API prezzi Tyre24 V13 (host tyre24.alzura.com/{country}/
// {lang}/rest/V13/tyres) — DOMINIO DIVERSO da api-b2b.alzura.com usato da
// lib/importers/tyre24Anonimo.js per gli ordini: token separato
// (TYRE24_PRICES_TOKEN), nessun client riusabile esisteva per questa API.
// Usato per analizzare i prodotti REALMENTE nostri (public.prodotti WHERE
// t24=false) — il flag t24 sul prodotto non ha relazione col fatto che
// interroghiamo Tyre24: qui Tyre24 è solo la fonte prezzi di riferimento.
//
// Verificato con chiamate live reali (vedi sessione di analisi): il prefisso
// di ricerca HSN{codice} usato dallo script Python originale non trova
// risultati; EAN{ean} (prefisso documentato nello swagger Tyre24, colonna
// public.prodotti.ean già affidabile) sì. /distributorList è fatturato per
// chiamata — va sempre passato da needsLevel2() (lib/tyre24/pricing.ts),
// mai chiamato incondizionatamente.
//
// Ogni chiamata (successo o errore) viene loggata via logApiCall per il
// monitoraggio (tab Monitoraggio della pagina admin) — sostituisce il
// contatore fragile in settings.json del tool Python originale.

import { logApiCall } from "./analisiDb";
import type { Tyre24Distributor, Tyre24SearchResponse } from "./pricing";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

function authToken(): string {
  const token = process.env.TYRE24_PRICES_TOKEN;
  if (!token) throw new Error("Missing TYRE24_PRICES_TOKEN");
  return token;
}

function baseUrl(country: string, lang: string): string {
  return `https://tyre24.alzura.com/${country}/${lang}/rest/V13/tyres`;
}

interface FetchResult {
  status: number | null;
  ok: boolean;
  retryCount: number;
  durationMs: number;
  json: unknown;
}

/** Fetch con retry/backoff esponenziale su 429/5xx — equivalente
 *  dell'urllib3.Retry(total=8, backoff_factor=2, status_forcelist=[429,...])
 *  usato dallo script Python, con un tetto più basso (3 tentativi) perché
 *  qui ogni retry costa un round-trip dentro una request HTTP Next.js, non
 *  un processo desktop libero di aspettare. */
async function fetchWithRetry(url: string, headers: Record<string, string>): Promise<FetchResult> {
  const started = Date.now();
  let attempt = 0;
  let lastStatus: number | null = null;

  while (attempt <= MAX_RETRIES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeout);
      lastStatus = res.status;
      if (res.ok) {
        const json = await res.json().catch(() => null);
        return { status: res.status, ok: true, retryCount: attempt, durationMs: Date.now() - started, json };
      }
      if (!RETRY_STATUS.has(res.status) || attempt === MAX_RETRIES) {
        return { status: res.status, ok: false, retryCount: attempt, durationMs: Date.now() - started, json: null };
      }
    } catch {
      clearTimeout(timeout);
      if (attempt === MAX_RETRIES) {
        return { status: null, ok: false, retryCount: attempt, durationMs: Date.now() - started, json: null };
      }
    }
    const backoffMs = 500 * 2 ** attempt + Math.random() * 250;
    await new Promise((r) => setTimeout(r, backoffMs));
    attempt++;
  }
  return { status: lastStatus, ok: false, retryCount: attempt, durationMs: Date.now() - started, json: null };
}

export interface T24SearchOpts {
  country: string;
  lang: string;
  minStock: number;
  jobId?: string | null;
  prodottoId?: string | null;
}

/** GET /search?search=EAN{ean}&minStock=&limit=1 — 1 chiamata economica,
 *  base del livello 1 (stima ek). Ritorna null su errore/nessun match. */
export async function t24Search(ean: string, opts: T24SearchOpts): Promise<Tyre24SearchResponse | null> {
  const url = `${baseUrl(opts.country, opts.lang)}/search?${new URLSearchParams({
    search: `EAN${ean}`,
    minStock: String(opts.minStock),
    limit: "1",
  })}`;
  const result = await fetchWithRetry(url, { "X-AUTH-TOKEN": authToken(), Accept: "application/json" });
  await logApiCall({
    jobId: opts.jobId, endpoint: "search", prodottoId: opts.prodottoId, ean,
    httpStatus: result.status, ok: result.ok, retryCount: result.retryCount, durationMs: result.durationMs,
  }).catch(() => {});
  if (!result.ok) return null;
  return result.json as Tyre24SearchResponse;
}

export interface T24DistributorListOpts {
  country: string;
  lang: string;
  minStock: number;
  jobId?: string | null;
  prodottoId?: string | null;
  ean?: string | null;
}

/** GET /distributorList?itemID=T{idT24}&minStock= — chiamata a pagamento,
 *  da invocare SOLO quando lib/tyre24/pricing.ts::needsLevel2() ritorna
 *  true. Ritorna array vuoto su errore (il chiamante tratta come "nessun
 *  distributore verificato", degrada alla stima di /search). */
export async function t24DistributorList(idT24: number, opts: T24DistributorListOpts): Promise<Tyre24Distributor[]> {
  const url = `${baseUrl(opts.country, opts.lang)}/distributorList?${new URLSearchParams({
    itemID: `T${idT24}`,
    minStock: String(opts.minStock),
  })}`;
  const result = await fetchWithRetry(url, { "X-AUTH-TOKEN": authToken(), Accept: "application/json" });
  await logApiCall({
    jobId: opts.jobId, endpoint: "distributorList", prodottoId: opts.prodottoId, ean: opts.ean,
    httpStatus: result.status, ok: result.ok, retryCount: result.retryCount, durationMs: result.durationMs,
  }).catch(() => {});
  if (!result.ok) return [];
  return (result.json as Tyre24Distributor[]) ?? [];
}
