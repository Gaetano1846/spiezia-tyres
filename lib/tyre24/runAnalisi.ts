// Logica di esecuzione dell'analisi prezzi Tyre24 — estratta da
// app/api/tyre24/analisi/route.ts in modo che sia richiamabile sia dalla
// POST (nuovo job) sia da instrumentation.ts (ripresa automatica dei job
// rimasti "running" dopo un riavvio/deploy del container). Il container
// Next.js è un processo Node persistente: se muore a metà di un job, il
// job resta "running" per sempre nel DB finché qualcosa non lo riprende.
//
// Ripresa: rifà la stessa query prodotti (ORDER BY id, deterministica) e
// prende i primi `Totale` risultati — lo stesso identico set della prima
// chiamata, senza dover salvare `limit` sul job — poi scarta i prodotti che
// hanno già una riga in b2b.t24_analisi_risultati per quel job_id, e
// riparte dai contatori già persistiti sul job.

import {
  updateAnalisiJobProgress, finishAnalisiJob, insertRisultati, listProdottiT24,
  listRunningJobs, getProcessedProdottoIds,
  type AnalisiRisultatoInput, type ProdottoT24, type AnalisiJobApi,
} from "./analisiDb";
import { t24Search, t24DistributorList } from "./pricesClient";
import { extractEk, extractIdT24, needsLevel2, buildRanking, computePav, suggestPrice, suggestPriceFromEk } from "./pricing";

const CONCURRENCY = 5;
const PROGRESS_FLUSH_EVERY = 20;

// ─── Shutdown "gentile" ─────────────────────────────────────────────────────
// Senza questo: quando il container viene ricreato (deploy), Docker manda
// SIGTERM e aspetta ~10s (stop_grace_period) prima di SIGKILL — durante
// quella finestra il vecchio processo Node continua a girare mentre il
// nuovo container parte già in parallelo e riprende lo stesso job (vedi
// resumeUnfinishedJobs). Risultato osservato in produzione: righe duplicate
// in b2b.t24_analisi_risultati e contatori del job incoerenti (due processi
// che scrivono updateAnalisiJobProgress con contatori locali indipendenti,
// vince l'ultima scrittura, non riflette il vero totale). Fix: appena
// arriva SIGTERM/SIGINT, i worker smettono di prendere nuovi prodotti dalla
// coda (finiscono solo quello già in corso), fanno un ultimo flush/update
// e uscono SENZA chiudere il job (resta "running", lo riprende il prossimo
// avvio) — così il vecchio processo si ferma davvero prima che il nuovo
// inizi a sovrapporsi.
let shuttingDown = false;
let shutdownHandlersRegistered = false;

function ensureShutdownHandlers(): void {
  if (shutdownHandlersRegistered) return;
  shutdownHandlersRegistered = true;
  const onSignal = (signal: string) => {
    console.log(`[tyre24] ${signal} ricevuto — fermo i job di analisi in corso (nessun nuovo prodotto verrà preso in carico)`);
    shuttingDown = true;
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
}

export interface RunParams {
  paese: string;
  lingua: string;
  marca?: string | null;
  minStock: number;
  sogliaDeltaPct: number;
  margineFisso: number;
  spedizione: number;
  commissionePct: number;
  pricingAdvantage: number;
}

async function analizzaProdotto(p: ProdottoT24, jobId: string, params: RunParams): Promise<{ risultato: AnalisiRisultatoInput; searchCalls: number; distributorCalls: number }> {
  if (!p.ean) {
    return {
      risultato: {
        jobId, prodottoId: p.id, ean: p.ean, cai: p.cai, sku: p.sku, titolo: p.titolo, marca: p.marca,
        stagione: p.stagione, idT24: null, prezzoAcquistoDb: p.prezzoAcquisto, prezzoAttualeMercato: p.prezzoAttualeMercato,
        ekStimato: null, ekVerificato: null, deltaPct: null, livello2: false, nostraPos: null, nostroStock: null,
        distributorNome: null, distributorStock: null, secondNome: null, secondPrezzo: null, secondStock: null,
        stockT24: p.stockT24, pav: null, prezzoSuggerito: null, stato: "no_match", note: "EAN mancante",
      },
      searchCalls: 0, distributorCalls: 0,
    };
  }

  const searchResp = await t24Search(p.ean, {
    country: params.paese, lang: params.lingua, minStock: params.minStock, jobId, prodottoId: p.id,
  });
  const ekStimato = extractEk(searchResp);
  const idT24 = extractIdT24(searchResp);

  if (ekStimato == null || idT24 == null) {
    return {
      risultato: {
        jobId, prodottoId: p.id, ean: p.ean, cai: p.cai, sku: p.sku, titolo: p.titolo, marca: p.marca,
        stagione: p.stagione, idT24, prezzoAcquistoDb: p.prezzoAcquisto, prezzoAttualeMercato: p.prezzoAttualeMercato,
        ekStimato: null, ekVerificato: null, deltaPct: null, livello2: false, nostraPos: null, nostroStock: null,
        distributorNome: null, distributorStock: null, secondNome: null, secondPrezzo: null, secondStock: null,
        stockT24: p.stockT24, pav: null, prezzoSuggerito: null, stato: "no_match", note: "Nessun match su Tyre24",
      },
      searchCalls: 1, distributorCalls: 0,
    };
  }

  const deltaPct = p.prezzoAttualeMercato ? Math.abs(ekStimato - p.prezzoAttualeMercato) / p.prezzoAttualeMercato : null;
  const livello2 = needsLevel2({ prezzoAttuale: p.prezzoAttualeMercato, ekStimato, sogliaEur: params.sogliaDeltaPct });

  let ekVerificato: number | null = null;
  let distributorNome: string | null = null;
  let distributorStock: number | null = null;
  let secondNome: string | null = null;
  let secondPrezzo: number | null = null;
  let secondStock: number | null = null;
  let nostraPos: number | null = null;
  let nostroStock: number | null = null;
  let distributorCalls = 0;
  let prezzoSuggerito: number | null;
  let note: string | null = null;

  if (livello2) {
    const distributors = await t24DistributorList(idT24, {
      country: params.paese, lang: params.lingua, minStock: params.minStock, jobId, prodottoId: p.id, ean: p.ean,
    });
    distributorCalls = 1;
    const { best, second, nostraPos: pos, nostroStock: stock } = buildRanking(distributors, params.minStock);
    nostraPos = pos;
    nostroStock = stock;
    if (best) {
      ekVerificato = best.price;
      distributorNome = best.name;
      distributorStock = best.stock;
    }
    if (second) {
      secondNome = second.name;
      secondPrezzo = second.price;
      secondStock = second.stock;
    }
    prezzoSuggerito = suggestPrice({ nostraPos, best, second, pricingAdvantage: params.pricingAdvantage });
    if (!best) {
      // Livello 2 pagato ma nessun distributore valido nella lista: degrada
      // alla stima gratuita invece di lasciare il prezzo suggerito vuoto.
      prezzoSuggerito = suggestPriceFromEk({ ekStimato, pricingAdvantage: params.pricingAdvantage });
      note = "livello 2 senza distributori — stima da /search";
    }
  } else {
    prezzoSuggerito = suggestPriceFromEk({ ekStimato, pricingAdvantage: params.pricingAdvantage });
  }

  // PAV: sempre dal costo d'acquisto, mai dalla stima/verifica Tyre24 — floor
  // di sicurezza indipendente dal prezzo suggerito competitor-relative.
  const pav = p.prezzoAcquisto != null
    ? computePav({ costo: p.prezzoAcquisto, margineFisso: params.margineFisso, spedizione: params.spedizione, commissionePct: params.commissionePct })
    : null;

  return {
    risultato: {
      jobId, prodottoId: p.id, ean: p.ean, cai: p.cai, sku: p.sku, titolo: p.titolo, marca: p.marca,
      stagione: p.stagione, idT24, prezzoAcquistoDb: p.prezzoAcquisto, prezzoAttualeMercato: p.prezzoAttualeMercato,
      ekStimato, ekVerificato, deltaPct, livello2, nostraPos, nostroStock,
      distributorNome, distributorStock, secondNome, secondPrezzo, secondStock,
      stockT24: p.stockT24, pav, prezzoSuggerito, stato: "ok", note,
    },
    searchCalls: 1, distributorCalls,
  };
}

export interface RunAnalisiJobOpts {
  /** prodotto_id già processati per questo job (ripresa dopo riavvio) —
   *  vengono saltati invece di essere rianalizzati (e ripagati). */
  skipProdottoIds?: Set<string>;
  /** Contatori da cui ripartire (ripresa) invece che da zero. */
  initialCounters?: {
    processati: number;
    conVariazione: number;
    searchCalls: number;
    distributorCalls: number;
    errori: number;
  };
}

export async function runAnalisiJob(jobId: string, prodottiCompleti: ProdottoT24[], params: RunParams, opts: RunAnalisiJobOpts = {}): Promise<void> {
  ensureShutdownHandlers();
  const skip = opts.skipProdottoIds ?? new Set<string>();
  const prodotti = skip.size > 0 ? prodottiCompleti.filter((p) => !skip.has(p.id)) : prodottiCompleti;

  let cursor = 0;
  let processati = opts.initialCounters?.processati ?? 0;
  let conVariazione = opts.initialCounters?.conVariazione ?? 0;
  let searchCalls = opts.initialCounters?.searchCalls ?? 0;
  let distributorCalls = opts.initialCounters?.distributorCalls ?? 0;
  let errori = opts.initialCounters?.errori ?? 0;
  let buffer: AnalisiRisultatoInput[] = [];

  async function flush() {
    if (buffer.length === 0) return;
    await insertRisultati(buffer);
    buffer = [];
  }

  async function worker() {
    while (!shuttingDown && cursor < prodotti.length) {
      const p = prodotti[cursor];
      cursor++;
      try {
        const { risultato, searchCalls: sc, distributorCalls: dc } = await analizzaProdotto(p, jobId, params);
        buffer.push(risultato);
        searchCalls += sc;
        distributorCalls += dc;
        if (risultato.stato === "ok" && risultato.prezzoSuggerito != null && risultato.prezzoAttualeMercato != null
          && Math.abs(risultato.prezzoSuggerito - risultato.prezzoAttualeMercato) > 0.01) {
          conVariazione++;
        }
      } catch (err) {
        errori++;
        buffer.push({
          jobId, prodottoId: p.id, ean: p.ean, cai: p.cai, sku: p.sku, titolo: p.titolo, marca: p.marca,
          stagione: p.stagione, idT24: null, prezzoAcquistoDb: p.prezzoAcquisto, prezzoAttualeMercato: p.prezzoAttualeMercato,
          ekStimato: null, ekVerificato: null, deltaPct: null, livello2: false, nostraPos: null, nostroStock: null,
          distributorNome: null, distributorStock: null, secondNome: null, secondPrezzo: null, secondStock: null,
          stockT24: p.stockT24, pav: null, prezzoSuggerito: null, stato: "errore",
          note: err instanceof Error ? err.message : "Errore sconosciuto",
        });
      }
      processati++;
      if (buffer.length >= PROGRESS_FLUSH_EVERY) {
        await flush();
        await updateAnalisiJobProgress(jobId, { processati, conVariazione, searchCalls, distributorCalls, errori });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, prodotti.length) }, () => worker()));
  await flush();
  await updateAnalisiJobProgress(jobId, { processati, conVariazione, searchCalls, distributorCalls, errori });

  if (shuttingDown) {
    // Fermato da SIGTERM/SIGINT, non da fine lavoro: il job resta "running"
    // così il prossimo avvio lo riprende (resumeUnfinishedJobs) invece di
    // considerarlo concluso a metà.
    console.log(`[tyre24] Job ${jobId}: interrotto da shutdown a ${processati} prodotti processati — resta "running", ripreso al prossimo avvio`);
    return;
  }

  await finishAnalisiJob(jobId, { stato: "done" });
}

/** Chiamata una volta all'avvio del server (vedi instrumentation.ts).
 *  Trova i job rimasti "running" (interrotti da un riavvio/deploy) e li
 *  riprende da dove erano arrivati, senza rianalizzare (e ripagare) i
 *  prodotti già fatti. */
export async function resumeUnfinishedJobs(): Promise<void> {
  const jobs = await listRunningJobs();
  if (jobs.length === 0) return;
  console.log(`[tyre24] Ripresa di ${jobs.length} job interrotti da un riavvio`);
  for (const job of jobs) {
    resumeOneJob(job).catch((err) => {
      console.error(`[tyre24] Errore nella ripresa del job ${job.id}:`, err);
    });
  }
}

async function resumeOneJob(job: AnalisiJobApi): Promise<void> {
  // Stessa query deterministica (ORDER BY id) usata alla creazione del job:
  // i primi `Totale` risultati sono esattamente lo stesso set di allora,
  // senza dover aver salvato il parametro `limit` sul job.
  const tuttiIProdotti = await listProdottiT24({ paese: job.Paese, marca: job.Marca });
  const prodotti = tuttiIProdotti.slice(0, job.Totale);
  const processedIds = await getProcessedProdottoIds(job.id);

  const params: RunParams = {
    paese: job.Paese, lingua: job.Lingua, marca: job.Marca, minStock: job.MinStock, sogliaDeltaPct: job.SogliaDeltaPct,
    margineFisso: job.MargineFisso, spedizione: job.Spedizione, commissionePct: job.CommissionePct,
    pricingAdvantage: job.PricingAdvantage,
  };

  console.log(`[tyre24] Job ${job.id}: ripreso da ${processedIds.length}/${job.Totale} prodotti già fatti`);

  await runAnalisiJob(job.id, prodotti, params, {
    skipProdottoIds: new Set(processedIds),
    initialCounters: {
      processati: job.Processati, conVariazione: job.ConVariazione,
      searchCalls: job.SearchCalls, distributorCalls: job.DistributorCalls, errori: job.Errori,
    },
  });
}
