// Accesso Postgres al dominio Ordini (Fase 0 della migrazione Ordini→Postgres,
// vedi piano in corso). core.ordini è già alimentato in tempo reale dal bridge
// spiezia-bridge (bidirezionale con Firestore, live e verificato — 24.7k righe,
// 0 backlog) — qui costruiamo solo il layer di LETTURA lato app, mirror di
// lib/clientiDb.ts. Le funzioni restituiscono una forma Postgres-friendly
// (id semplici invece di DocumentReference, ISO string invece di Timestamp)
// così le pagine ripuntate in Fase 1 non devono re-implementare i JOIN.
//
// Due difficoltà reali del modello dati (vedi mapping/ordini.mjs nel repo
// Spiezia-DB), già gestite lato bridge, NON da ripetere qui:
//  · Data: data_ora è popolato con fallback DataOra ?? DataCreazione ?? CreatedAt
//    — comunque usiamo coalesce(data_ora, created_at) per sicurezza anche sui
//    pochi doc storici senza alcuna data riconoscibile.
//  · Numero: colonna intera pura (Flutter: id numerico; checkout/converti:
//    parte numerica di "ORD-YYYY-NNNNN"). Il formato display originale, se
//    presente, è preservato in fs_extra.Numero.

import { getDb, newId } from "@/lib/db";
import type { Pagamento, Indirizzo } from "@/lib/types";

export interface ArticoloOrdineApi {
  Sku: string | null;
  Titolo: string | null;
  Marca: string | null;
  Quantita: number;
  PrezzoUnitario: number | null;
  PFU: number | null;
  ContributoLogistico: number | null;
  PrezzoTotale: number | null;
  /** Path del doc Firestore Prodotti originale (es. "Prodotti/xyz") — Prodotti
   *  resta su Firestore, questo serve solo a ricostruire il riferimento per lo
   *  stock-lookup lato pagina di dettaglio. */
  RefPath: string | null;
  /** Campi non mappati a colonne dedicate (es. Immagine) — mai persi, vedi
   *  mapping/ordini.mjs::buildArticoliRecords nel repo bridge. */
  FsExtra: Record<string, unknown>;
}

export interface CronologiaEntryApi {
  id: string;
  Ts: string | null;
  Autore: string | null;
  Testo: string | null;
  /** Motivo/nota libera associata alla voce (es. motivo annullamento) — campo
   *  distinto da Testo per compatibilità con l'admin, che mostra Azione e
   *  Nota su righe separate. Mai una colonna dedicata, vive in fs_extra.Nota. */
  Nota: string | null;
}

export interface NoteInternaApi {
  id: string;
  Ts: string | null;
  Autore: string | null;
  Testo: string | null;
}

export interface OrdineListItemApi {
  id: string;
  Numero: string | null;
  Source: string;
  Stato: string;
  ClienteId: string | null;
  ClienteNome: string | null;
  UtenteId: string | null;
  UtenteNome: string | null;
  Totale: number;
  Data: string | null;
  /** Presenti anche in lista (non solo dettaglio): servono alla UI admin per
   *  validare/etichettare un cambio-stato senza un secondo fetch. */
  Corriere: string | null;
  GlsTrackingNumber: string | null;
  /** Conteggio articoli — la lista ordini cliente mostra "N articoli" senza
   *  caricare il dettaglio completo di ogni riga. */
  ArticoliCount: number;
  /** Destinatario dell'indirizzo di spedizione dell'ordine (estratto lato SQL
   *  da indirizzo_spedizione->>'Destinatario'). Per ordini AdTyres/Prezzo-Gomme
   *  il ClienteNome risolto è il rivenditore/reseller (billing), non il cliente
   *  finale — l'admin usa questo campo per mostrare il vero destinatario. */
  SpedizioneDestinatario: string | null;
}

export interface OrdineApi extends OrdineListItemApi {
  SedeId: string | null;
  IVA: number | null;
  PFU: number | null;
  ScontoTotale: number | null;
  ContributoLogistico: number | null;
  Pagamento: Pagamento | null;
  IndirizzoFatturazione: Indirizzo | null;
  IndirizzoSpedizione: Indirizzo | null;
  Colli: number | null;
  Peso: number | null;
  GlsPdfUrl: string | null;
  /** BDA per le spedizioni GLS (external_order_id) — sempre popolato,
   *  indipendente dalla sorgente (checkout/importer/Flutter). */
  ExternalOrderId: string | null;
  GlsContractIndex: number | null;
  PdfUrl: string | null;
  Note: string | null;
  MotivoAnnullamento: string | null;
  /** Paese Tyre24 ("it"/estero) — colonna dedicata, scritta dagli importer
   *  Tyre24 (tyre24PgWrite.js). Usato da lib/marketplace/sdk.js per lo
   *  shipping_company_id Alzura, non esposto prima di questa migrazione. */
  T24Country: string | null;
  /** Campi non mappati a colonne dedicate (marketplace id, SpeseExtra quando
   *  arriva come array, ecc.) — mai persi, vedi mapping/ordini.mjs nel repo
   *  bridge. Le pagine di dettaglio leggono da qui i campi "ambigui". */
  FsExtra: Record<string, unknown>;
  Articoli: ArticoloOrdineApi[];
  Cronologia: CronologiaEntryApi[];
  NoteInterne: NoteInternaApi[];
}

const LIST_COLS = `o.id, o.numero, o.source, o.stato, o.cliente_id, o.utente_id, o.totale,
  coalesce(o.data_ora, o.created_at) AS effective_date, o.fs_extra->>'Numero' AS numero_display,
  o.corriere, o.gls_tracking_number,
  coalesce(NULLIF(c.ragione_sociale, ''), c.nome) AS cliente_nome,
  u.display_name AS utente_nome,
  o.indirizzo_spedizione->>'Destinatario' AS spedizione_destinatario,
  (SELECT count(*) FROM core.ordine_articoli oa WHERE oa.ordine_id = o.id) AS articoli_count`;

const DETAIL_COLS = `${LIST_COLS}, o.sede_id, o.iva, o.pfu, o.sconto_totale, o.contributo_logistico,
  o.pagamento, o.indirizzo_fatturazione, o.indirizzo_spedizione, o.colli, o.peso,
  o.gls_pdf_url, o.external_order_id, o.gls_contract_index,
  o.pdf_url, o.note, o.motivo_annullamento, o.t24_country, o.fs_extra`;

function isoOrNull(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function rowToListItem(r: Record<string, unknown>): OrdineListItemApi {
  return {
    id: r.id as string,
    Numero: (r.numero_display as string) ?? (r.numero != null ? String(r.numero) : null),
    Source: (r.source as string) ?? "Sconosciuto",
    Stato: (r.stato as string) ?? "In Lavorazione",
    ClienteId: (r.cliente_id as string) ?? null,
    ClienteNome: (r.cliente_nome as string) ?? null,
    UtenteId: (r.utente_id as string) ?? null,
    UtenteNome: (r.utente_nome as string) ?? null,
    Totale: Number(r.totale ?? 0),
    Data: isoOrNull(r.effective_date),
    Corriere: (r.corriere as string) ?? null,
    GlsTrackingNumber: (r.gls_tracking_number as string) ?? null,
    ArticoliCount: Number(r.articoli_count ?? 0),
    SpedizioneDestinatario: (r.spedizione_destinatario as string) || null,
  };
}

function rowToOrdine(r: Record<string, unknown>): OrdineApi {
  return {
    ...rowToListItem(r),
    SedeId: (r.sede_id as string) ?? null,
    IVA: r.iva != null ? Number(r.iva) : null,
    PFU: r.pfu != null ? Number(r.pfu) : null,
    ScontoTotale: r.sconto_totale != null ? Number(r.sconto_totale) : null,
    ContributoLogistico: r.contributo_logistico != null ? Number(r.contributo_logistico) : null,
    Pagamento: (r.pagamento as Pagamento) ?? null,
    IndirizzoFatturazione: (r.indirizzo_fatturazione as Indirizzo) ?? null,
    IndirizzoSpedizione: (r.indirizzo_spedizione as Indirizzo) ?? null,
    Colli: r.colli != null ? Number(r.colli) : null,
    Peso: r.peso != null ? Number(r.peso) : null,
    GlsPdfUrl: (r.gls_pdf_url as string) ?? null,
    ExternalOrderId: (r.external_order_id as string) ?? null,
    GlsContractIndex: r.gls_contract_index != null ? Number(r.gls_contract_index) : null,
    PdfUrl: (r.pdf_url as string) ?? null,
    Note: (r.note as string) ?? null,
    MotivoAnnullamento: (r.motivo_annullamento as string) ?? null,
    T24Country: (r.t24_country as string) ?? null,
    FsExtra: (r.fs_extra as Record<string, unknown>) ?? {},
    Articoli: [],
    Cronologia: [],
    NoteInterne: [],
  };
}

function rowToArticolo(r: Record<string, unknown>): ArticoloOrdineApi {
  return {
    Sku: (r.sku as string) ?? null,
    Titolo: (r.titolo as string) ?? null,
    Marca: (r.marca as string) ?? null,
    Quantita: Number(r.quantita ?? 0),
    PrezzoUnitario: r.prezzo_unitario != null ? Number(r.prezzo_unitario) : null,
    PFU: r.pfu != null ? Number(r.pfu) : null,
    ContributoLogistico: r.contributo_logistico != null ? Number(r.contributo_logistico) : null,
    PrezzoTotale: r.tot_riga != null ? Number(r.tot_riga) : null,
    RefPath: (r.ref_path as string) ?? null,
    FsExtra: (r.fs_extra as Record<string, unknown>) ?? {},
  };
}

// Normalizza le due forme incontrate su Cronologia/Note_Interne (vedi
// mapping/ordini.mjs nel repo bridge) in un'unica forma canonica — le pagine
// non devono più sapere se una voce viene da un importer o dall'admin B2B.
function rowToCronologiaEntry(r: Record<string, unknown>): CronologiaEntryApi {
  const fsExtra = (r.fs_extra as Record<string, unknown>) ?? {};
  return {
    id: r.id as string,
    Ts: isoOrNull(r.data),
    Autore: (fsExtra.Operatore as string) ?? null,
    Testo: (r.note as string) ?? null,
    Nota: (fsExtra.Nota as string) ?? null,
  };
}

function rowToNoteInterna(r: Record<string, unknown>): NoteInternaApi {
  const fsExtra = (r.fs_extra as Record<string, unknown>) ?? {};
  return {
    id: r.id as string,
    Ts: isoOrNull(r.created_at),
    Autore: (fsExtra.Operatore as string) ?? null,
    Testo: (r.testo as string) ?? null,
  };
}

export interface ListOrdiniFilters {
  /** Un solo ordine per utente O cliente (self-service cliente/rep). */
  utenteId?: string;
  clienteId?: string;
  /** Molti utenti/clienti insieme (rappresentante — sostituisce le query
   *  Firestore "in" chunked a 30 con un singolo ANY($1) senza limite). */
  utenteIds?: string[];
  clienteIds?: string[];
  dataDa?: string; // ISO
  dataA?: string;  // ISO
  fonti?: string[];
  stato?: string;
  /** Ricerca libera: numero, id esterno, nome/ragione sociale cliente. */
  q?: string;
  limit?: number;
}

/** Lista ordini con filtri — sostituisce le query dirette Firestore in
 *  admin/ordini, client/ordini, rappresentante/ordini, CRM cliente-detail. */
export async function listOrdini(filters: ListOrdiniFilters = {}): Promise<OrdineListItemApi[]> {
  const db = getDb();
  if (!db) return [];

  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (filters.utenteId) where.push(`o.utente_id = ${push(filters.utenteId)}`);
  if (filters.clienteId) where.push(`o.cliente_id = ${push(filters.clienteId)}`);
  if (filters.utenteIds?.length || filters.clienteIds?.length) {
    const parts: string[] = [];
    if (filters.utenteIds?.length) parts.push(`o.utente_id = ANY(${push(filters.utenteIds)})`);
    if (filters.clienteIds?.length) parts.push(`o.cliente_id = ANY(${push(filters.clienteIds)})`);
    where.push(`(${parts.join(" OR ")})`);
  }
  // dataDa/dataA arrivano come stringhe naive "YYYY-MM-DDTHH:mm:ss" che
  // rappresentano l'inizio/fine giornata in ora ITALIANA (vedi
  // app/api/admin/ordini/route.ts). Il pool Postgres ha TimeZone di sessione
  // UTC, quindi un bind diretto contro una colonna timestamptz le interpreta
  // come UTC — sfasando il confine di 1-2h (CET/CEST) e facendo "trapelare"
  // ordini di inizio giornata successiva nel giorno precedente. AT TIME ZONE
  // le reinterpreta esplicitamente come ora locale Europe/Rome (DST-aware).
  if (filters.dataDa) where.push(`coalesce(o.data_ora, o.created_at) >= (${push(filters.dataDa)}::timestamp AT TIME ZONE 'Europe/Rome')`);
  if (filters.dataA) where.push(`coalesce(o.data_ora, o.created_at) <= (${push(filters.dataA)}::timestamp AT TIME ZONE 'Europe/Rome')`);
  if (filters.fonti?.length) where.push(`o.source = ANY(${push(filters.fonti)})`);
  if (filters.stato) where.push(`o.stato = ${push(filters.stato)}`);
  if (filters.q?.trim()) {
    const term = `%${filters.q.trim()}%`;
    const p1 = push(term);
    where.push(
      `(o.search_text ILIKE ${p1} OR coalesce(NULLIF(c.ragione_sociale,''), c.nome) ILIKE ${p1})`
    );
  }

  const limit = filters.limit ?? 2000;
  const sql = `
    SELECT ${LIST_COLS}
      FROM core.ordini o
      LEFT JOIN core.clienti c ON c.id = o.cliente_id
      LEFT JOIN core.utenti u ON u.id = o.utente_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY effective_date DESC
     LIMIT ${push(limit)}`;

  const { rows } = await db.query(sql, params);
  return rows.map(rowToListItem);
}

/** Dettaglio completo di un ordine — Articoli + Cronologia + Note_Interne. */
export async function getOrdine(id: string): Promise<OrdineApi | null> {
  const db = getDb();
  if (!db) return null;

  const { rows } = await db.query(
    `SELECT ${DETAIL_COLS}
       FROM core.ordini o
       LEFT JOIN core.clienti c ON c.id = o.cliente_id
       LEFT JOIN core.utenti u ON u.id = o.utente_id
      WHERE o.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const ordine = rowToOrdine(rows[0]);

  const [articoli, cronologia, noteInterne] = await Promise.all([
    db.query(
      `SELECT sku, titolo, marca, quantita, prezzo_unitario, pfu, contributo_logistico, tot_riga, ref_path, fs_extra
         FROM core.ordine_articoli WHERE ordine_id = $1 ORDER BY riga`,
      [id]
    ),
    db.query(
      `SELECT id, data, note, fs_extra FROM b2b.ordini_cronologia WHERE ordine_id = $1 ORDER BY data ASC NULLS LAST`,
      [id]
    ),
    db.query(
      `SELECT id, testo, created_at, fs_extra FROM b2b.ordini_note_interne WHERE ordine_id = $1 ORDER BY created_at DESC`,
      [id]
    ),
  ]);

  ordine.Articoli = articoli.rows.map(rowToArticolo);
  ordine.Cronologia = cronologia.rows.map(rowToCronologiaEntry);
  ordine.NoteInterne = noteInterne.rows.map(rowToNoteInterna);
  return ordine;
}

/** Conteggio + totale fatturato per una lista di filtri (KPI leggere, senza
 *  caricare le righe intere — usata da eventuali stat card). */
export async function countOrdini(filters: Pick<ListOrdiniFilters, "dataDa" | "dataA" | "fonti" | "stato">): Promise<{ count: number; revenue: number }> {
  const db = getDb();
  if (!db) return { count: 0, revenue: 0 };

  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (filters.dataDa) where.push(`coalesce(data_ora, created_at) >= ${push(filters.dataDa)}`);
  if (filters.dataA) where.push(`coalesce(data_ora, created_at) <= ${push(filters.dataA)}`);
  if (filters.fonti?.length) where.push(`source = ANY(${push(filters.fonti)})`);
  if (filters.stato) where.push(`stato = ${push(filters.stato)}`);

  const { rows } = await db.query(
    `SELECT count(*) AS count, coalesce(sum(totale), 0) AS revenue
       FROM core.ordini
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`,
    params
  );
  return { count: Number(rows[0]?.count ?? 0), revenue: Number(rows[0]?.revenue ?? 0) };
}

export interface OrdineExportRow {
  id: string;
  Numero: string | null;
  Source: string;
  Stato: string;
  Totale: number;
  IVA: number | null;
  Pagamento: Pagamento | null;
  IndirizzoFatturazione: Indirizzo | null;
  IndirizzoSpedizione: Indirizzo | null;
  Data: string | null;
  Articoli: { Sku: string | null; Titolo: string | null; Quantita: number; PFU: number | null; RefPath: string | null }[];
}

/** Righe per export CSV — Articoli aggregati in una singola query (JOIN +
 *  json_agg) invece di N+1 fetch per ordine. Condivisa da entrambi i flussi
 *  di export (bulk "ultimi N" e selezione manuale per id). */
export async function listOrdiniForExport(filter: { ids?: string[]; limit?: number } = {}): Promise<OrdineExportRow[]> {
  const db = getDb();
  if (!db) return [];

  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.ids?.length) {
    params.push(filter.ids);
    where.push(`o.id = ANY($${params.length})`);
  }
  params.push(filter.limit ?? 2000);

  const { rows } = await db.query(
    `SELECT o.id, o.numero, o.source, o.stato, o.totale, o.iva, o.pagamento,
       o.indirizzo_fatturazione, o.indirizzo_spedizione,
       coalesce(o.data_ora, o.created_at) AS effective_date,
       o.fs_extra->>'Numero' AS numero_display,
       coalesce(
         json_agg(json_build_object(
           'sku', oa.sku, 'titolo', oa.titolo, 'quantita', oa.quantita,
           'pfu', oa.pfu, 'ref_path', oa.ref_path
         ) ORDER BY oa.riga) FILTER (WHERE oa.id IS NOT NULL),
         '[]'
       ) AS articoli
     FROM core.ordini o
     LEFT JOIN core.ordine_articoli oa ON oa.ordine_id = o.id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     GROUP BY o.id
     ORDER BY effective_date DESC
     LIMIT $${params.length}`,
    params
  );

  return rows.map((r) => ({
    id: r.id as string,
    Numero: (r.numero_display as string) ?? (r.numero != null ? String(r.numero) : null),
    Source: (r.source as string) ?? "Sconosciuto",
    Stato: (r.stato as string) ?? "In Lavorazione",
    Totale: Number(r.totale ?? 0),
    IVA: r.iva != null ? Number(r.iva) : null,
    Pagamento: (r.pagamento as Pagamento) ?? null,
    IndirizzoFatturazione: (r.indirizzo_fatturazione as Indirizzo) ?? null,
    IndirizzoSpedizione: (r.indirizzo_spedizione as Indirizzo) ?? null,
    Data: isoOrNull(r.effective_date),
    Articoli: (r.articoli as Array<Record<string, unknown>>).map((a) => ({
      Sku: (a.sku as string) ?? null,
      Titolo: (a.titolo as string) ?? null,
      Quantita: Number(a.quantita ?? 0),
      PFU: a.pfu != null ? Number(a.pfu) : null,
      RefPath: (a.ref_path as string) ?? null,
    })),
  }));
}

export interface OrdineDocumentoApi {
  ordineId: string;
  Numero: string | null;
  Data: string | null;
  Tipo: string;
  Url: string;
}

/** Documenti scaricabili (fattura PDF + eventuali allegati) sugli ultimi
 *  ordini del cliente — "PDF" è colonna dedicata, "Documenti[]" (allegati
 *  vari, non presente su tutti gli ordini) non è mappato a colonna e vive
 *  in fs_extra. Filtra server-side solo gli ordini che hanno qualcosa da
 *  mostrare, invece di scaricare gli ultimi N e filtrare lato client. */
export async function listOrdiniDocumenti(utenteId: string, limitN = 100): Promise<OrdineDocumentoApi[]> {
  const db = getDb();
  if (!db) return [];

  const { rows } = await db.query(
    `SELECT id, numero, fs_extra->>'Numero' AS numero_display,
       coalesce(data_ora, created_at) AS effective_date,
       pdf_url, fs_extra->'Documenti' AS documenti
     FROM core.ordini
     WHERE utente_id = $1 AND (pdf_url IS NOT NULL OR fs_extra ? 'Documenti')
     ORDER BY effective_date DESC
     LIMIT $2`,
    [utenteId, limitN]
  );

  const out: OrdineDocumentoApi[] = [];
  for (const r of rows) {
    const ordineId = r.id as string;
    const Numero = (r.numero_display as string) ?? (r.numero != null ? String(r.numero) : null);
    const Data = isoOrNull(r.effective_date);
    if (r.pdf_url) out.push({ ordineId, Numero, Data, Tipo: "Fattura", Url: r.pdf_url as string });
    const documenti = Array.isArray(r.documenti) ? (r.documenti as Array<{ Tipo?: string; Link?: string }>) : [];
    for (const d of documenti) {
      if (d.Link) out.push({ ordineId, Numero, Data, Tipo: d.Tipo ?? "Documento", Url: d.Link });
    }
  }
  return out;
}

async function rowExists(table: "sedi" | "clienti" | "utenti", id: string): Promise<boolean> {
  const pool = getDb();
  if (!pool) return false;
  const { rows } = await pool.query(`SELECT 1 FROM core.${table} WHERE id = $1`, [id]);
  return rows.length > 0;
}

/**
 * Verifica che l'id sede esista davvero in core.sedi prima di usarlo come
 * sede_id su core.ordini (FK ordini_sede_fk, NOT VALID sulle righe storiche
 * ma applicata su ogni nuovo insert). I chiamanti (checkout,
 * converti-preventivo) risolvono la sede con un fallback storico a "main"
 * per il contatore Firestore Counters/{sedeId} — "main" non è mai un id
 * sede reale (i doc Sedi hanno id Firestore casuali), quindi passato as-is
 * romperebbe l'insert con una violazione di FK. Ritorna null (sede
 * sconosciuta, mai un id inventato) invece di far fallire l'intero ordine.
 */
export async function resolveSedeId(candidate: string | null | undefined): Promise<string | null> {
  if (!candidate) return null;
  return (await rowExists("sedi", candidate)) ? candidate : null;
}

/**
 * Stessa logica di resolveSedeId per cliente_id/utente_id (FK
 * ordini_cliente_fk/ordini_utente_fk). Rilevante soprattutto per utente_id:
 * il fallback Firebase legacy in lib/auth.ts::getSession() verifica solo
 * l'esistenza del doc Firestore, non della riga Postgres sincronizzata dal
 * bridge — un gap di sync (raro ma possibile) altrimenti farebbe fallire
 * l'intero checkout con una violazione di FK invece di limitarsi a perdere
 * il collegamento "chi ha ordinato" (da preservare comunque in fs_extra dal
 * chiamante, se rilevante).
 */
export async function resolvePersonaId(
  table: "clienti" | "utenti",
  candidate: string | null | undefined
): Promise<string | null> {
  if (!candidate) return null;
  return (await rowExists(table, candidate)) ? candidate : null;
}

// ─── Scrittura (Fase 2 migrazione Ordini) ──────────────────────────────────
//
// Generalizza lib/importers/tyre24PgWrite.js::insertOrderPg() — stesso
// pattern (BEGIN/INSERT core.ordini/INSERT core.ordine_articoli/COMMIT,
// idempotenza via ON CONFLICT(id) DO NOTHING) per i writer con id
// auto-generato (checkout B2B, converti-preventivo) invece di id
// deterministico esterno. Il bridge esistente propaga automaticamente ogni
// riga scritta qui verso Firestore, per il CRM Flutter legacy.

export interface CreateOrdineArticoloInput {
  sku?: string | null;
  titolo?: string | null;
  marca?: string | null;
  quantita: number;
  prezzoUnitario?: number | null;
  pfu?: number | null;
  contributoLogistico?: number | null;
  refPath?: string | null;
  totRiga?: number | null;
  fsExtra?: Record<string, unknown>;
}

export interface CreateOrdineInput {
  /** Se assente, generato con newId() (ULID-like, valido come id Firestore). */
  id?: string;
  /** Contatore grezzo (int) — Numero (stringa display "ORD-YYYY-NNNNN") va in
   *  numeroDisplay, preservato in fs_extra.Numero (mai una colonna dedicata). */
  numero?: number | null;
  numeroDisplay?: string | null;
  source: string;
  externalOrderId?: string | null;
  stato: string;
  sedeId?: string | null;
  clienteId?: string | null;
  utenteId?: string | null;
  createdBy?: string | null;
  totale: number;
  iva?: number | null;
  pfu?: number | null;
  scontoTotale?: number | null;
  contributoLogistico?: number | null;
  pagamento?: Record<string, unknown> | null;
  indirizzoFatturazione?: Record<string, unknown> | null;
  indirizzoSpedizione?: Record<string, unknown> | null;
  note?: string | null;
  fsExtra?: Record<string, unknown>;
  articoli: CreateOrdineArticoloInput[];
}

/** Crea un ordine + articoli in una singola transazione. `skipped: true` se
 *  l'id esiste già (idempotenza via PRIMARY KEY, equivalente a .create()). */
export async function createOrdine(input: CreateOrdineInput): Promise<{ id: string; skipped: boolean }> {
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");

  const id = input.id ?? newId();
  const fsExtra = { ...(input.fsExtra ?? {}) };
  if (input.numeroDisplay) fsExtra.Numero = input.numeroDisplay;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const inserted = await client.query(
      `INSERT INTO core.ordini (
         id, numero, source, external_order_id, stato, sede_id, cliente_id, utente_id, created_by,
         totale, iva, pfu, sconto_totale, contributo_logistico, pagamento,
         indirizzo_fatturazione, indirizzo_spedizione, note, data_ora, created_at, fs_extra
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now(),now(),$19)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [
        id, input.numero ?? null, input.source, input.externalOrderId ?? null, input.stato,
        input.sedeId ?? null, input.clienteId ?? null, input.utenteId ?? null, input.createdBy ?? null,
        input.totale, input.iva ?? null, input.pfu ?? null, input.scontoTotale ?? null, input.contributoLogistico ?? null,
        input.pagamento ? JSON.stringify(input.pagamento) : null,
        input.indirizzoFatturazione ? JSON.stringify(input.indirizzoFatturazione) : null,
        input.indirizzoSpedizione ? JSON.stringify(input.indirizzoSpedizione) : null,
        input.note ?? null,
        JSON.stringify(fsExtra),
      ]
    );

    if (inserted.rows.length === 0) {
      await client.query("ROLLBACK");
      return { id, skipped: true };
    }

    for (let riga = 0; riga < input.articoli.length; riga++) {
      const a = input.articoli[riga];
      await client.query(
        `INSERT INTO core.ordine_articoli
           (ordine_id, riga, sku, titolo, marca, quantita, prezzo_unitario, pfu, contributo_logistico, ref_path, tot_riga, fs_extra)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id, riga, a.sku ?? null, a.titolo ?? null, a.marca ?? null, a.quantita,
          a.prezzoUnitario ?? null, a.pfu ?? null, a.contributoLogistico ?? null,
          a.refPath ?? null, a.totRiga ?? null, JSON.stringify(a.fsExtra ?? {}),
        ]
      );
    }

    await client.query("COMMIT");
    return { id, skipped: false };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Cambio-stato / Cronologia / Note_Interne (Fase 4 migrazione Spedizioni/GLS) ──
//
// Prima scrittura Postgres per questo dominio: cambio-stato ordine dall'admin,
// creazione GLS/chiusura/eliminazione spedizioni. Consolidati qui perché la
// stessa coppia Stato+Cronologia era duplicata a mano in 3 punti (dettaglio
// ordine, lista ordini, job bulk GLS) — un'unica funzione condivisa chiude il
// rischio di drift tra le copie.

export interface UpdateOrdineStatoOpts {
  motivoAnnullamento?: string | null;
  glsTrackingNumber?: string | null;
}

export async function updateOrdineStato(id: string, stato: string, opts: UpdateOrdineStatoOpts = {}): Promise<void> {
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");
  await pool.query(
    `UPDATE core.ordini
        SET stato = $1,
            motivo_annullamento = coalesce($2, motivo_annullamento),
            gls_tracking_number = coalesce($3, gls_tracking_number),
            updated_at = now()
      WHERE id = $4`,
    [stato, opts.motivoAnnullamento ?? null, opts.glsTrackingNumber ?? null, id]
  );
}

export interface AppendCronologiaInput {
  /** Testo principale (es. "Stato → Spedito") — diventa Testo/Evento in lettura. */
  azione: string;
  /** Motivo/nota libera opzionale (es. motivo annullamento) — preservata in
   *  fs_extra.Nota, stesso shape già prodotto dal bridge per le voci storiche
   *  scritte via Firestore (vedi mapping/ordini.mjs::buildCronologiaRecord). */
  nota?: string | null;
  operatore: string;
  utenteId?: string | null;
}

export async function appendCronologia(ordineId: string, input: AppendCronologiaInput): Promise<void> {
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");
  const fsExtra: Record<string, unknown> = { Operatore: input.operatore };
  if (input.nota) fsExtra.Nota = input.nota;
  await pool.query(
    `INSERT INTO b2b.ordini_cronologia (id, ordine_id, data, utente_id, note, fs_extra)
     VALUES ($1,$2,now(),$3,$4,$5)`,
    [newId(), ordineId, input.utenteId ?? null, input.azione, JSON.stringify(fsExtra)]
  );
}

export interface AppendNotaInternaInput {
  testo: string;
  operatore: string;
}

export async function appendNotaInterna(ordineId: string, input: AppendNotaInternaInput): Promise<{ id: string; ts: string }> {
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");
  const id = newId();
  const { rows } = await pool.query(
    `INSERT INTO b2b.ordini_note_interne (id, ordine_id, testo, fs_extra)
     VALUES ($1,$2,$3,$4)
     RETURNING created_at`,
    [id, ordineId, input.testo, JSON.stringify({ Operatore: input.operatore })]
  );
  return { id, ts: (rows[0].created_at as Date).toISOString() };
}

export async function updateOrdineColli(id: string, colli: number, peso: number): Promise<void> {
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");
  await pool.query(`UPDATE core.ordini SET colli = $1, peso = $2, updated_at = now() WHERE id = $3`, [colli, peso, id]);
}

export async function updateOrdineTracking(id: string, trackingNumber: string): Promise<void> {
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");
  await pool.query(`UPDATE core.ordini SET gls_tracking_number = $1, updated_at = now() WHERE id = $2`, [trackingNumber, id]);
}

export async function updateOrdineIndirizzi(
  id: string,
  fields: { indirizzoFatturazione?: Record<string, unknown>; indirizzoSpedizione?: Record<string, unknown> }
): Promise<void> {
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");
  await pool.query(
    `UPDATE core.ordini
        SET indirizzo_fatturazione = coalesce($1, indirizzo_fatturazione),
            indirizzo_spedizione = coalesce($2, indirizzo_spedizione),
            updated_at = now()
      WHERE id = $3`,
    [
      fields.indirizzoFatturazione ? JSON.stringify(fields.indirizzoFatturazione) : null,
      fields.indirizzoSpedizione ? JSON.stringify(fields.indirizzoSpedizione) : null,
      id,
    ]
  );
}

export interface UpdateOrdineGlsInput {
  stato?: string;
  glsTrackingNumber?: string | null;
  glsPdfUrl?: string | null;
  glsContractIndex?: number | null;
  corriere?: string | null;
  /** Merge shallow in fs_extra (jsonb ||) — per i campi GLS_ e ZPL_ senza
   *  colonna dedicata (GLS_Tracking, GLS_Status, ZPL_Labels, ecc.), stesso
   *  nome esatto usato dal writer Firestore storico (mapping/ordini.mjs li
   *  passa già così com'è nel catch-all fs_extra). Il merge via || invece
   *  di un replace JS evita una race persa tra scritture ravvicinate sullo
   *  stesso ordine (es. processOrderParcels seguito a ruota da processOrderZpl). */
  fsExtraMerge?: Record<string, unknown>;
}

export async function updateOrdineGls(id: string, input: UpdateOrdineGlsInput): Promise<void> {
  const pool = getDb();
  if (!pool) throw new Error("Postgres non configurato");
  await pool.query(
    `UPDATE core.ordini
        SET stato = coalesce($1, stato),
            gls_tracking_number = coalesce($2, gls_tracking_number),
            gls_pdf_url = coalesce($3, gls_pdf_url),
            gls_contract_index = coalesce($4, gls_contract_index),
            corriere = coalesce($5, corriere),
            fs_extra = fs_extra || $6::jsonb,
            updated_at = now()
      WHERE id = $7`,
    [
      input.stato ?? null, input.glsTrackingNumber ?? null, input.glsPdfUrl ?? null,
      input.glsContractIndex ?? null, input.corriere ?? null,
      JSON.stringify(input.fsExtraMerge ?? {}), id,
    ]
  );
}
