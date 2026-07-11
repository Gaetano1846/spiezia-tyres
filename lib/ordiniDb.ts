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

import { getDb } from "@/lib/db";
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
  PdfUrl: string | null;
  Note: string | null;
  MotivoAnnullamento: string | null;
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
  (SELECT count(*) FROM core.ordine_articoli oa WHERE oa.ordine_id = o.id) AS articoli_count`;

const DETAIL_COLS = `${LIST_COLS}, o.sede_id, o.iva, o.pfu, o.sconto_totale, o.contributo_logistico,
  o.pagamento, o.indirizzo_fatturazione, o.indirizzo_spedizione, o.colli, o.peso,
  o.gls_pdf_url, o.pdf_url, o.note, o.motivo_annullamento, o.fs_extra`;

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
    PdfUrl: (r.pdf_url as string) ?? null,
    Note: (r.note as string) ?? null,
    MotivoAnnullamento: (r.motivo_annullamento as string) ?? null,
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
  if (filters.dataDa) where.push(`coalesce(o.data_ora, o.created_at) >= ${push(filters.dataDa)}`);
  if (filters.dataA) where.push(`coalesce(o.data_ora, o.created_at) <= ${push(filters.dataA)}`);
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
