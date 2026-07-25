// Accesso Postgres per l'analisi prezzi Tyre24 (pagina admin
// /admin/tyre24-prezzi). Pattern job/progress identico a spedizioniDb.ts
// (b2b.spedizioni_jobs) — Postgres-autoritativo, nessuna infra realtime,
// il frontend fa polling breve. t24_api_log è il meccanismo di monitoraggio
// autoritativo delle chiamate a pagamento (sostituisce il contatore fragile
// in settings.json del tool Python originale).

import { getDb, newId } from "@/lib/db";

// ─── Prodotti target ────────────────────────────────────────────────────────
// t24=true NON sono prodotti nostri: è il catalogo esterno Tyre24 mirrorato
// per riferimento (152k righe, escluso dal catalogo B2B storefront). I
// prodotti da ripriced sono quelli con t24=false (16.880 righe) — i prodotti
// realmente nostri. L'API Tyre24 qui è usata solo come fonte prezzi esterna
// di riferimento per calcolare il costo di acquisto corrente, indipendente
// dal flag t24 del prodotto stesso.
//
// Corretto il 2026-07-20 dopo un'analisi lanciata in produzione sul set
// sbagliato (t24=true, 136k prodotti) — fermata dopo 264/136146 righe (10
// chiamate /distributorList) da un restart del container. Vedi Gotcha nel
// vault Obsidian del progetto.

export interface ProdottoT24 {
  id: string;
  ean: string | null;
  cai: string | null;
  sku: string | null;
  titolo: string | null;
  marca: string | null;
  stagione: string | null;
  prezzoAcquisto: number | null;
  /** Prezzo di VENDITA nostro per il mercato selezionato nel job (non il
   *  costo) — colonna scelta da PAESE_PREZZO_COL in base a `paese`. */
  prezzoAttualeMercato: number | null;
  stockT24: number;
}

function rowToProdottoT24(r: Record<string, unknown>): ProdottoT24 {
  return {
    id: r.id as string,
    ean: (r.ean as string) ?? null,
    cai: (r.cai as string) ?? null,
    sku: (r.sku as string) ?? null,
    titolo: (r.titolo as string) ?? null,
    marca: (r.marca as string) ?? null,
    stagione: (r.stagione as string) ?? null,
    prezzoAcquisto: r.prezzo_acquisto != null ? Number(r.prezzo_acquisto) : null,
    prezzoAttualeMercato: r.prezzo_attuale_mercato != null ? Number(r.prezzo_attuale_mercato) : null,
    stockT24: Number(r.stock_t24 ?? 0),
  };
}

// Mappa paese (codice mercato Tyre24) -> colonna prezzo di vendita su
// public.prodotti. Whitelist fissa: il valore entra nell'SQL come nome di
// colonna (non come parametro bind), quindi non deve MAI derivare da input
// non controllato — solo dai 7 codici mercato noti. "es" (Spagna) non ha una
// colonna dedicata: usa prezzo_benelux come già fa il resto del sistema
// (storefront Prezzo-Gomme) — decisione business, non un placeholder da
// correggere qui.
const PAESE_PREZZO_COL: Record<string, string> = {
  it: "prezzo_privato",
  de: "prezzo_germania",
  fr: "prezzo_francia",
  at: "prezzo_austria",
  be: "prezzo_benelux",
  pl: "prezzo_polonia",
  es: "prezzo_benelux",
};

export interface ListProdottiT24Opts {
  paese: string;
  /** Filtro marca esatto — undefined/null/"" = tutte le marche. */
  marca?: string | null;
  limit?: number;
}

/** Prodotti nostri (t24=false, NON il catalogo esterno Tyre24) con EAN
 *  valido — senza EAN non si può cercare su Tyre24 (identificatore usato
 *  per /search, vedi pricesClient). ORDER BY id invariato: la ripresa job
 *  (resumeOneJob) rifà questa stessa query e prende i primi N — deve
 *  restare deterministica. */
export async function listProdottiT24(opts: ListProdottiT24Opts): Promise<ProdottoT24[]> {
  const db = getDb();
  if (!db) return [];
  const col = PAESE_PREZZO_COL[opts.paese] ?? "prezzo_privato";
  const params: unknown[] = [];
  let marcaClause = "";
  if (opts.marca) {
    params.push(opts.marca);
    marcaClause = ` AND marca = $${params.length}`;
  }
  let limitClause = "";
  if (opts.limit) {
    params.push(opts.limit);
    limitClause = ` LIMIT $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT id, ean, cai, sku, titolo, marca, stagione, prezzo_acquisto, stock_t24,
            ${col} AS prezzo_attuale_mercato
       FROM public.prodotti
      WHERE t24 = false AND ean IS NOT NULL AND ean <> ''${marcaClause}
      ORDER BY id${limitClause}`,
    params
  );
  return rows.map(rowToProdottoT24);
}

/** Marche distinte tra i prodotti nostri — alimenta il dropdown filtro
 *  marca nella pagina admin (niente lista hardcoded, segue il catalogo). */
export async function listMarcheProdotti(): Promise<string[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(
    `SELECT DISTINCT marca FROM public.prodotti
      WHERE t24 = false AND marca IS NOT NULL AND marca <> ''
      ORDER BY marca`
  );
  return rows.map((r) => r.marca as string);
}

// ─── Job di analisi ────────────────────────────────────────────────────────

export interface AnalisiJobApi {
  id: string;
  Stato: string;
  Paese: string;
  Lingua: string;
  Marca: string | null;
  MinStock: number;
  SogliaDeltaPct: number;
  MargineFisso: number;
  Spedizione: number;
  CommissionePct: number;
  PricingAdvantage: number;
  Totale: number;
  Processati: number;
  ConVariazione: number;
  SearchCalls: number;
  DistributorCalls: number;
  Errori: number;
  CreatedBy: string | null;
  CreatedAt: string | null;
  UpdatedAt: string | null;
  FinishedAt: string | null;
  Error: string | null;
}

function rowToAnalisiJob(r: Record<string, unknown>): AnalisiJobApi {
  return {
    id: r.id as string,
    Stato: (r.stato as string) ?? "running",
    Paese: r.paese as string,
    Lingua: r.lingua as string,
    Marca: (r.marca as string) ?? null,
    MinStock: Number(r.min_stock ?? 0),
    SogliaDeltaPct: Number(r.soglia_delta_pct ?? 0),
    MargineFisso: Number(r.margine_fisso ?? 0),
    Spedizione: Number(r.spedizione ?? 0),
    CommissionePct: Number(r.commissione_pct ?? 0),
    PricingAdvantage: Number(r.pricing_advantage ?? 0),
    Totale: Number(r.totale ?? 0),
    Processati: Number(r.processati ?? 0),
    ConVariazione: Number(r.con_variazione ?? 0),
    SearchCalls: Number(r.search_calls ?? 0),
    DistributorCalls: Number(r.distributor_calls ?? 0),
    Errori: Number(r.errori ?? 0),
    CreatedBy: (r.created_by as string) ?? null,
    CreatedAt: r.created_at ? (r.created_at as Date).toISOString() : null,
    UpdatedAt: r.updated_at ? (r.updated_at as Date).toISOString() : null,
    FinishedAt: r.finished_at ? (r.finished_at as Date).toISOString() : null,
    Error: (r.error as string) ?? null,
  };
}

export interface CreateAnalisiJobInput {
  paese: string;
  lingua: string;
  marca?: string | null;
  minStock: number;
  sogliaDeltaPct: number;
  margineFisso: number;
  spedizione: number;
  commissionePct: number;
  pricingAdvantage: number;
  totale: number;
  createdBy?: string | null;
}

export async function createAnalisiJob(input: CreateAnalisiJobInput): Promise<string> {
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");
  const id = newId();
  await pool.query(
    `INSERT INTO b2b.t24_analisi_jobs
       (id, paese, lingua, marca, min_stock, soglia_delta_pct, margine_fisso, spedizione,
        commissione_pct, pricing_advantage, totale, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())`,
    [
      id, input.paese, input.lingua, input.marca ?? null, input.minStock, input.sogliaDeltaPct,
      input.margineFisso, input.spedizione, input.commissionePct, input.pricingAdvantage, input.totale,
      input.createdBy ?? null,
    ]
  );
  return id;
}

export async function getAnalisiJob(id: string): Promise<AnalisiJobApi | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query(`SELECT * FROM b2b.t24_analisi_jobs WHERE id = $1`, [id]);
  return rows[0] ? rowToAnalisiJob(rows[0]) : null;
}

/** Job rimasti "running" — usato solo da resumeUnfinishedJobs() all'avvio
 *  del server per riprendere i job interrotti da un riavvio/deploy. */
export async function listRunningJobs(): Promise<AnalisiJobApi[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(`SELECT * FROM b2b.t24_analisi_jobs WHERE stato = 'running'`);
  return rows.map(rowToAnalisiJob);
}

/** Job più recente (in corso, o l'ultimo concluso se nessuno è in corso) —
 *  usato dalla pagina admin per ritrovare un'analisi in corso anche da un
 *  browser/sessione diversi da chi l'ha avviata (il localStorage locale è
 *  solo un fast-path, non l'unica fonte: senza questo, aprire la pagina da
 *  un'altra finestra/computer non mostra un job che sta comunque girando). */
export async function getLatestJob(): Promise<AnalisiJobApi | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query(
    `SELECT * FROM b2b.t24_analisi_jobs
      ORDER BY (stato = 'running') DESC, created_at DESC
      LIMIT 1`
  );
  return rows[0] ? rowToAnalisiJob(rows[0]) : null;
}

/** Job passati, per lo storico consultabile nella pagina admin (tab
 *  "Storico") — a differenza di getLatestJob/listRunningJobs, questa
 *  restituisce PIÙ job ordinati per data, non solo l'ultimo/i "running".
 *  Pattern fetch limit+1 identico a getRisultati per calcolare hasMore. */
export async function listRecentJobs(opts: { limit?: number; offset?: number } = {}): Promise<{ jobs: AnalisiJobApi[]; hasMore: boolean }> {
  const db = getDb();
  if (!db) return { jobs: [], hasMore: false };
  const limit = opts.limit ?? 20;
  const { rows } = await db.query(
    `SELECT * FROM b2b.t24_analisi_jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit + 1, opts.offset ?? 0]
  );
  const hasMore = rows.length > limit;
  return { jobs: rows.slice(0, limit).map(rowToAnalisiJob), hasMore };
}

/** prodotto_id già processati per un job — usato per saltarli in fase di
 *  ripresa (non rianalizzarli, non richiamare Tyre24 inutilmente). */
export async function getProcessedProdottoIds(jobId: string): Promise<string[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(
    `SELECT DISTINCT prodotto_id FROM b2b.t24_analisi_risultati WHERE job_id = $1`,
    [jobId]
  );
  return rows.map((r) => r.prodotto_id as string);
}

export interface UpdateAnalisiJobProgressInput {
  processati: number;
  conVariazione: number;
  searchCalls: number;
  distributorCalls: number;
  errori: number;
}

export async function updateAnalisiJobProgress(id: string, input: UpdateAnalisiJobProgressInput): Promise<void> {
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");
  await pool.query(
    `UPDATE b2b.t24_analisi_jobs
        SET processati = $1, con_variazione = $2, search_calls = $3,
            distributor_calls = $4, errori = $5, updated_at = now()
      WHERE id = $6`,
    [input.processati, input.conVariazione, input.searchCalls, input.distributorCalls, input.errori, id]
  );
}

export interface FinishAnalisiJobInput {
  stato: "done" | "error";
  error?: string;
}

export async function finishAnalisiJob(id: string, input: FinishAnalisiJobInput): Promise<void> {
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");
  await pool.query(
    `UPDATE b2b.t24_analisi_jobs
        SET stato = $1, error = coalesce($2, error), finished_at = now(), updated_at = now()
      WHERE id = $3`,
    [input.stato, input.error ?? null, id]
  );
}

// ─── Risultati per prodotto ────────────────────────────────────────────────

export interface AnalisiRisultatoInput {
  jobId: string;
  prodottoId: string;
  ean: string | null;
  cai: string | null;
  sku: string | null;
  titolo: string | null;
  marca: string | null;
  stagione: string | null;
  idT24: number | null;
  prezzoAcquistoDb: number | null;
  /** Prezzo di vendita nostro per il mercato del job (non il costo). */
  prezzoAttualeMercato: number | null;
  ekStimato: number | null;
  ekVerificato: number | null;
  deltaPct: number | null;
  livello2: boolean;
  /** 1-indexed nella classifica completa (noi inclusi); null = non trovati
   *  ("ASSENTI") quando livello2=true, oppure non calcolato quando livello2=false. */
  nostraPos: number | null;
  nostroStock: number | null;
  distributorNome: string | null;
  distributorStock: number | null;
  secondNome: string | null;
  secondPrezzo: number | null;
  secondStock: number | null;
  /** Stock INTERNO del prodotto (public.prodotti.stock_t24) — usato per
   *  "Proiezione profitto" nell'export XLSX, NON lo stesso di nostroStock
   *  (quello è lo stock che Tyre24 riporta per il nostro listing). */
  stockT24: number;
  pav: number | null;
  prezzoSuggerito: number | null;
  stato: "ok" | "no_match" | "errore";
  note: string | null;
}

export interface AnalisiRisultatoApi extends Omit<AnalisiRisultatoInput, "jobId"> {
  id: string;
  jobId: string;
}

function rowToRisultato(r: Record<string, unknown>): AnalisiRisultatoApi {
  return {
    id: r.id as string,
    jobId: r.job_id as string,
    prodottoId: r.prodotto_id as string,
    ean: (r.ean as string) ?? null,
    cai: (r.cai as string) ?? null,
    sku: (r.sku as string) ?? null,
    titolo: (r.titolo as string) ?? null,
    marca: (r.marca as string) ?? null,
    stagione: (r.stagione as string) ?? null,
    idT24: r.id_t24 != null ? Number(r.id_t24) : null,
    prezzoAcquistoDb: r.prezzo_acquisto_db != null ? Number(r.prezzo_acquisto_db) : null,
    prezzoAttualeMercato: r.prezzo_attuale_mercato != null ? Number(r.prezzo_attuale_mercato) : null,
    ekStimato: r.ek_stimato != null ? Number(r.ek_stimato) : null,
    ekVerificato: r.ek_verificato != null ? Number(r.ek_verificato) : null,
    deltaPct: r.delta_pct != null ? Number(r.delta_pct) : null,
    livello2: Boolean(r.livello2),
    nostraPos: r.nostra_pos != null ? Number(r.nostra_pos) : null,
    nostroStock: r.nostro_stock != null ? Number(r.nostro_stock) : null,
    distributorNome: (r.distributor_nome as string) ?? null,
    distributorStock: r.distributor_stock != null ? Number(r.distributor_stock) : null,
    secondNome: (r.second_nome as string) ?? null,
    secondPrezzo: r.second_prezzo != null ? Number(r.second_prezzo) : null,
    secondStock: r.second_stock != null ? Number(r.second_stock) : null,
    stockT24: Number(r.stock_t24 ?? 0),
    pav: r.pav != null ? Number(r.pav) : null,
    prezzoSuggerito: r.prezzo_suggerito != null ? Number(r.prezzo_suggerito) : null,
    stato: r.stato as AnalisiRisultatoApi["stato"],
    note: (r.note as string) ?? null,
  };
}

/** Inserimento batch in singola transazione — chiamato periodicamente dal
 *  runner (non riga per riga) per limitare i round-trip DB durante un job
 *  che può processare migliaia di prodotti. */
export async function insertRisultati(rows: AnalisiRisultatoInput[]): Promise<void> {
  if (rows.length === 0) return;
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of rows) {
      // ON CONFLICT su (job_id, prodotto_id) — vedi migration 033: anche con
      // lo shutdown "gentile" resta una finestra di race non eliminabile a
      // tempo tra il container che si ferma e quello che riprende (vedi
      // Gotcha 2026-07-20 nel vault). Questo rende il duplicato impossibile
      // a livello DB invece di inseguire il timing.
      await client.query(
        `INSERT INTO b2b.t24_analisi_risultati
           (id, job_id, prodotto_id, ean, cai, sku, titolo, marca, stagione, id_t24,
            prezzo_acquisto_db, prezzo_attuale_mercato, ek_stimato, ek_verificato, delta_pct, livello2,
            nostra_pos, nostro_stock, distributor_nome, distributor_stock,
            second_nome, second_prezzo, second_stock, stock_t24, pav, prezzo_suggerito, stato, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
         ON CONFLICT (job_id, prodotto_id) DO NOTHING`,
        [
          newId(), r.jobId, r.prodottoId, r.ean, r.cai, r.sku, r.titolo, r.marca, r.stagione, r.idT24,
          r.prezzoAcquistoDb, r.prezzoAttualeMercato, r.ekStimato, r.ekVerificato, r.deltaPct, r.livello2,
          r.nostraPos, r.nostroStock, r.distributorNome, r.distributorStock,
          r.secondNome, r.secondPrezzo, r.secondStock, r.stockT24, r.pav, r.prezzoSuggerito, r.stato, r.note,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface GetRisultatiOpts {
  livello2?: boolean;
  stato?: string;
  limit?: number;
  offset?: number;
}

export async function getRisultati(jobId: string, opts: GetRisultatiOpts = {}): Promise<{ rows: AnalisiRisultatoApi[]; hasMore: boolean }> {
  const db = getDb();
  if (!db) return { rows: [], hasMore: false };
  const params: unknown[] = [jobId];
  let clause = "";
  if (opts.livello2 !== undefined) {
    params.push(opts.livello2);
    clause += ` AND livello2 = $${params.length}`;
  }
  if (opts.stato) {
    params.push(opts.stato);
    clause += ` AND stato = $${params.length}`;
  }
  const limit = opts.limit ?? 100;
  params.push(limit + 1);
  const limitIdx = params.length;
  params.push(opts.offset ?? 0);
  const { rows } = await db.query(
    `SELECT * FROM b2b.t24_analisi_risultati WHERE job_id = $1 ${clause}
      ORDER BY id LIMIT $${limitIdx} OFFSET $${limitIdx + 1}`,
    params
  );
  const hasMore = rows.length > limit;
  return { rows: rows.slice(0, limit).map(rowToRisultato), hasMore };
}

/** Export completo (senza paginazione) per il CSV — usato solo dalla route
 *  di export, mai dalla tabella a schermo (che pagina con getRisultati).
 *  Stessi filtri livello2/stato della tabella, così l'export riflette
 *  esattamente quello che si vede a schermo (es. nascondere i "no_match"). */
export async function getAllRisultati(jobId: string, opts: GetRisultatiOpts = {}): Promise<AnalisiRisultatoApi[]> {
  const db = getDb();
  if (!db) return [];
  const params: unknown[] = [jobId];
  let clause = "";
  if (opts.livello2 !== undefined) {
    params.push(opts.livello2);
    clause += ` AND livello2 = $${params.length}`;
  }
  if (opts.stato) {
    params.push(opts.stato);
    clause += ` AND stato = $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT * FROM b2b.t24_analisi_risultati WHERE job_id = $1 ${clause} ORDER BY id`,
    params
  );
  return rows.map(rowToRisultato);
}

// getRisultatiConNoiStessi/updateRisultatoVerifica (bug "noi stessi come
// miglior distributore", corretto il 2026-07-20) rimosse il 2026-07-21: con
// la nuova buildRanking (include noi stessi e usa il 2° classificato quando
// siamo primi) questo bug non può più accadere — non serve più la
// ri-verifica mirata. Vedi anche rimozione di
// app/api/tyre24/analisi/[id]/riverifica-self/route.ts.

// ─── Log chiamate API (monitoraggio) ───────────────────────────────────────

export interface LogApiCallInput {
  jobId?: string | null;
  endpoint: "search" | "distributorList";
  prodottoId?: string | null;
  ean?: string | null;
  httpStatus: number | null;
  ok: boolean;
  retryCount: number;
  durationMs: number;
}

/** Registra una singola chiamata API — meccanismo di monitoraggio
 *  autoritativo (dashboard /admin/tyre24-prezzi, tab Monitoraggio). Non deve
 *  mai far fallire la chiamata Tyre24 che la genera: chiamare in try/catch
 *  dal chiamante se necessario, qui si lascia propagare l'errore DB. */
export async function logApiCall(input: LogApiCallInput): Promise<void> {
  const pool = getDb();
  if (!pool) return;
  await pool.query(
    `INSERT INTO b2b.t24_api_log (job_id, endpoint, prodotto_id, ean, http_status, ok, retry_count, duration_ms, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
    [input.jobId ?? null, input.endpoint, input.prodottoId ?? null, input.ean ?? null, input.httpStatus, input.ok, input.retryCount, input.durationMs]
  );
}

export interface MonitoringKpi {
  searchCallsOggi: number;
  distributorCallsOggi: number;
  searchCallsSettimana: number;
  distributorCallsSettimana: number;
  searchCallsMese: number;
  distributorCallsMese: number;
  erroriMese: number;
}

export async function getMonitoringKpi(): Promise<MonitoringKpi> {
  const db = getDb();
  if (!db) {
    return {
      searchCallsOggi: 0, distributorCallsOggi: 0,
      searchCallsSettimana: 0, distributorCallsSettimana: 0,
      searchCallsMese: 0, distributorCallsMese: 0, erroriMese: 0,
    };
  }
  const { rows } = await db.query(`
    SELECT
      count(*) FILTER (WHERE endpoint = 'search' AND created_at >= date_trunc('day', now())) AS search_oggi,
      count(*) FILTER (WHERE endpoint = 'distributorList' AND created_at >= date_trunc('day', now())) AS dist_oggi,
      count(*) FILTER (WHERE endpoint = 'search' AND created_at >= now() - interval '7 days') AS search_settimana,
      count(*) FILTER (WHERE endpoint = 'distributorList' AND created_at >= now() - interval '7 days') AS dist_settimana,
      count(*) FILTER (WHERE endpoint = 'search' AND created_at >= now() - interval '30 days') AS search_mese,
      count(*) FILTER (WHERE endpoint = 'distributorList' AND created_at >= now() - interval '30 days') AS dist_mese,
      count(*) FILTER (WHERE ok = false AND created_at >= now() - interval '30 days') AS errori_mese
    FROM b2b.t24_api_log
  `);
  const r = rows[0] ?? {};
  return {
    searchCallsOggi: Number(r.search_oggi ?? 0),
    distributorCallsOggi: Number(r.dist_oggi ?? 0),
    searchCallsSettimana: Number(r.search_settimana ?? 0),
    distributorCallsSettimana: Number(r.dist_settimana ?? 0),
    searchCallsMese: Number(r.search_mese ?? 0),
    distributorCallsMese: Number(r.dist_mese ?? 0),
    erroriMese: Number(r.errori_mese ?? 0),
  };
}

export interface CallsTimeSeriesPoint {
  giorno: string; // YYYY-MM-DD
  search: number;
  distributorList: number;
}

/** Serie temporale ultimi 30 giorni per il grafico chiamate (recharts). */
export async function getCallsTimeSeries(): Promise<CallsTimeSeriesPoint[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS giorno,
           count(*) FILTER (WHERE endpoint = 'search') AS search,
           count(*) FILTER (WHERE endpoint = 'distributorList') AS distributor_list
      FROM b2b.t24_api_log
     WHERE created_at >= now() - interval '30 days'
     GROUP BY 1
     ORDER BY 1
  `);
  return rows.map((r) => ({
    giorno: r.giorno as string,
    search: Number(r.search ?? 0),
    distributorList: Number(r.distributor_list ?? 0),
  }));
}
