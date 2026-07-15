// Letture dirette Postgres su public.prodotti per casi che richiedono dati
// pieni/live (non l'indice di ricerca Meilisearch, che è una proiezione con
// un set di campi limitato — non include ad es. gli stock "Occupato").
// Oggi usato solo dallo scan EAN dell'app Flutter magazzino: un lookup
// puntuale, non una ricerca, quindi niente indice.

import { getDb, newId } from "@/lib/db";
import { stockColumnForSede } from "@/lib/magazzinoDb";
import { resolveSkuFromFirestoreDocId } from "@/lib/resolveSkuFromFirestore";
import type { Ruolo } from "@/lib/types";

export interface ProdottoFullApi {
  id: string;
  Titolo: string | null;
  Descrizione: string | null;
  Larghezza: number | null;
  Altezza: number | null;
  Diametro: number | null;
  Indice_Bagnato: string | null;
  Indice_Consumo: string | null;
  Indice_Rumorosita: string | null;
  Indice_Carico: string | null;
  Indice_Velocita: string | null;
  Marca: string | null;
  Modello: string | null;
  CAI: string | null;
  EAN: string | null;
  SKU: string | null;
  Stagione: string | null;
  Categoria: string | null;
  Immagine: string | null;
  Foto: string | null;
  Prezzo: number | null;
  Prezzo_Gommista: number | null;
  Prezzo_Grossista: number | null;
  Prezzo_Privato: number | null;
  Prezzo_Acquisto: number | null;
  PFU: number | null;
  Stock_Nola: number;
  Stock_Nola_2: number;
  Stock_Roma: number;
  Stock_Volla: number;
  Stock_Portici: number;
  Stock_OCP: number;
  Stock_T24: number;
  Stock_Nola_Occupato: number;
  Stock_Nola_2_Occupato: number;
  Stock_Roma_Occupato: number;
  Stock_Volla_Occupato: number;
  Stock_Portici_Occupato: number;
  T24: boolean;
}

// Ruoli staff: gestiscono il catalogo → vedono tutti i prezzi. Ruoli cliente:
// vedono SOLO il prezzo del proprio livello, mai Acquisto/altri tier — stesso
// criterio già in uso in app/api/prodotti/search/route.ts::stripPrices, qui
// riportato per la shape ProdottoFullApi (diversa da ProdottoHit/Meili).
const STAFF_ROLES = new Set<Ruolo>(["Admin", "Magazziniere", "Impiegato", "Rappresentante"]);

export function stripProductPrices(p: ProdottoFullApi, ruolo: Ruolo | undefined, crm: boolean): ProdottoFullApi {
  if ((ruolo && STAFF_ROLES.has(ruolo)) || crm) return p;
  const tier =
    ruolo === "Grossista" ? p.Prezzo_Grossista :
    ruolo === "Privato"   ? p.Prezzo_Privato :
    p.Prezzo_Gommista;
  const effettivo = tier ?? p.Prezzo_Gommista ?? p.Prezzo ?? null;
  return {
    ...p,
    Prezzo: effettivo,
    Prezzo_Gommista: ruolo === "Grossista" || ruolo === "Privato" ? null : effettivo,
    Prezzo_Grossista: ruolo === "Grossista" ? effettivo : null,
    Prezzo_Privato: ruolo === "Privato" ? effettivo : null,
    Prezzo_Acquisto: null, // mai al browser
  };
}

function rowToProdotto(r: Record<string, unknown>): ProdottoFullApi {
  return {
    id: r.id as string,
    Titolo: (r.titolo as string) ?? null,
    Descrizione: (r.descrizione as string) ?? null,
    Larghezza: (r.larghezza as number) ?? null,
    Altezza: (r.altezza as number) ?? null,
    Diametro: (r.diametro as number) ?? null,
    Indice_Bagnato: (r.indice_bagnato as string) ?? null,
    Indice_Consumo: (r.indice_consumo as string) ?? null,
    Indice_Rumorosita: (r.indice_rumorosita as string) ?? null,
    Indice_Carico: (r.indice_carico as string) ?? null,
    Indice_Velocita: (r.indice_velocita as string) ?? null,
    Marca: (r.marca as string) ?? null,
    Modello: (r.modello as string) ?? null,
    CAI: (r.cai as string) ?? null,
    EAN: (r.ean as string) ?? null,
    SKU: (r.sku as string) ?? null,
    Stagione: (r.stagione as string) ?? null,
    Categoria: (r.categoria as string) ?? null,
    Immagine: (r.immagine as string) ?? null,
    Foto: (r.foto as string) ?? null,
    // Non esiste una colonna "prezzo" generica su public.prodotti (solo per
    // ruolo/paese: prezzo_t24/prezzo_gommista/ecc.) — mai stata mappata,
    // null esplicito invece di far fallire la query. Non consumato da
    // nessuno screen raggiungibile dell'app (verificato).
    Prezzo: null,
    Prezzo_Gommista: r.prezzo_gommista != null ? Number(r.prezzo_gommista) : null,
    Prezzo_Grossista: r.prezzo_grossista != null ? Number(r.prezzo_grossista) : null,
    Prezzo_Privato: r.prezzo_privato != null ? Number(r.prezzo_privato) : null,
    Prezzo_Acquisto: r.prezzo_acquisto != null ? Number(r.prezzo_acquisto) : null,
    PFU: r.pfu != null ? Number(r.pfu) : null,
    Stock_Nola: Number(r.stock_nola ?? 0),
    Stock_Nola_2: Number(r.stock_nola_2 ?? 0),
    Stock_Roma: Number(r.stock_roma ?? 0),
    Stock_Volla: Number(r.stock_volla ?? 0),
    Stock_Portici: Number(r.stock_portici ?? 0),
    Stock_OCP: Number(r.stock_ocp ?? 0),
    Stock_T24: Number(r.stock_t24 ?? 0),
    Stock_Nola_Occupato: Number(r.stock_nola_occupato ?? 0),
    Stock_Nola_2_Occupato: Number(r.stock_nola_2_occupato ?? 0),
    Stock_Roma_Occupato: Number(r.stock_roma_occupato ?? 0),
    Stock_Volla_Occupato: Number(r.stock_volla_occupato ?? 0),
    Stock_Portici_Occupato: Number(r.stock_portici_occupato ?? 0),
    T24: r.t24 === true,
  };
}

const SELECT_COLS = `id, titolo, descrizione, larghezza, altezza, diametro, indice_bagnato, indice_consumo,
  indice_rumorosita, indice_carico, indice_velocita, marca, modello, cai, ean, sku, stagione, categoria,
  immagine, foto, prezzo_gommista, prezzo_grossista, prezzo_privato, prezzo_acquisto, pfu,
  stock_nola, stock_nola_2, stock_roma, stock_volla, stock_portici, stock_ocp, stock_t24,
  stock_nola_occupato, stock_nola_2_occupato, stock_roma_occupato, stock_volla_occupato, stock_portici_occupato,
  t24`;

/** Match esatto EAN, T24=false — porta il comportamento della vecchia query Firestore su Prodotti (app magazzino, scan barcode). */
export async function getProdottoByEan(ean: string): Promise<ProdottoFullApi | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query(
    `SELECT ${SELECT_COLS} FROM public.prodotti WHERE ean = $1 AND t24 = false LIMIT 1`,
    [ean]
  );
  return rows[0] ? rowToProdotto(rows[0]) : null;
}

/** Lookup per id (SKU) — dettaglio prodotto già identificato altrove (screen Magazzino: card dentro/fuori gabbia).
 *
 *  I lotti dentro b2b.magazzino.prodotti (Prodotto_Ref) sono quasi tutti dati
 *  storici migrati as-is da Firestore Magazzino.pneumaticiIN/prodotti, che
 *  contenevano dei veri DocumentReference verso la collection Prodotti — il
 *  loro `.id` è il doc ID Firestore, NON lo SKU (stesso motivo documentato in
 *  lib/importers/tyre24PgWrite.js::resolveArticlesPg: public.prodotti.id è
 *  SKU-based, un catalogo diverso, mai stato una migrazione diretta di
 *  Prodotti). Verificato sul DB prod: 2442/2442 righe di b2b.magazzino non
 *  matchano nessuno SKU direttamente. Fallback: se il lookup diretto fallisce,
 *  proviamo a risolvere id come doc ID Firestore e recuperare il suo SKU. */
export async function getProdottoById(id: string): Promise<ProdottoFullApi | null> {
  const db = getDb();
  if (!db) return null;
  const direct = await db.query(`SELECT ${SELECT_COLS} FROM public.prodotti WHERE id = $1 LIMIT 1`, [id]);
  if (direct.rows[0]) return rowToProdotto(direct.rows[0]);

  const sku = await resolveSkuFromFirestoreDocId(id);
  if (!sku || sku === id) return null;
  const byFsId = await db.query(`SELECT ${SELECT_COLS} FROM public.prodotti WHERE id = $1 LIMIT 1`, [sku]);
  return byFsId.rows[0] ? rowToProdotto(byFsId.rows[0]) : null;
}

/** Lookup batch per id (SKU) — usato per risolvere PFU/Prezzo_Acquisto di più
 *  articoli ordine in una sola query (es. export CSV ordini). Niente fallback
 *  doc-ID Firestore qui: gli SKU vengono già da core.ordine_articoli.sku,
 *  sempre canonici (a differenza dei lotti storici in b2b.magazzino). */
export async function getProdottiByIds(ids: string[]): Promise<ProdottoFullApi[]> {
  const db = getDb();
  if (!db || ids.length === 0) return [];
  const { rows } = await db.query(`SELECT ${SELECT_COLS} FROM public.prodotti WHERE id = ANY($1)`, [ids]);
  return rows.map(rowToProdotto);
}

/** Cascata di rinomina disegno (Modello) sui prodotti — chiamata da
 *  admin/disegni accanto alla rinomina del doc Firestore Modello (che resta
 *  invariata). Ritorna il numero di righe aggiornate, per il toast admin. */
export async function renameModelloProdotti(oldNome: string, nome: string): Promise<number> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const { rowCount } = await db.query(`UPDATE public.prodotti SET modello = $1 WHERE modello = $2`, [nome, oldNome]);
  return rowCount ?? 0;
}

export interface CreateProdottoStubInput {
  ean: string;
  titolo: string;
  quantita: number;
  sedeId: string;
}

/** Crea un prodotto "stub" (titolo+EAN+stock iniziale in UNA sede, nessun
 *  prezzo/marca/dimensioni) per lo scan magazzino di un EAN sconosciuto —
 *  mirror di CreaProdottoWidget (app Flutter). id = ULID generato (nessuno
 *  SKU reale disponibile a questo punto), t24 sempre false esplicito, source
 *  distinto ('magazzino-stub') per rintracciare le righe da completare.
 *  Prezzo assente per design: i job di sync marketplace/CSV escludono i
 *  prodotti a prezzo zero, quindi uno stub non genera annunci esterni finché
 *  un admin non lo completa. stockColumnForSede sceglie sempre una delle 5
 *  colonne stock fisse (mai input diretto), interpolazione sicura. */
export async function createProdottoStub(input: CreateProdottoStubInput): Promise<ProdottoFullApi> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const { rows: sedeRows } = await db.query(`SELECT nome FROM core.sedi WHERE id = $1`, [input.sedeId]);
  const stockCol = stockColumnForSede((sedeRows[0]?.nome as string) ?? "—");
  const id = newId();
  await db.query(
    `INSERT INTO public.prodotti (id, ean, titolo, ${stockCol}, t24, source)
     VALUES ($1, $2, $3, $4, false, 'magazzino-stub')`,
    [id, input.ean, input.titolo, input.quantita]
  );
  return (await getProdottoById(id))!;
}
