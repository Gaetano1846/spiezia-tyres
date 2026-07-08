// Accesso Postgres al dominio Magazzino/Gabbie (Fase 6 — cutover app→Postgres).
// b2b.magazzino è ora la fonte autoritativa per le scritture: il bridge le
// propaga a Firestore, così il CRM FlutterFlow legacy continua a vederle.
//
// I lotti (`prodotti`/`pneumatici_in`) sono jsonb con riferimenti Firestore
// nella forma { "__ref": "Prodotti/<id>" } (prodotto della REST API di
// backfill) — invariata qui, letta/scritta nello stesso formato così il
// bridge non deve fare nessuna trasformazione aggiuntiva.
//
// I prodotti referenziati vivono su public.prodotti (già migrato in Fase 2),
// risolti qui con una singola query bulk invece degli N getDoc per-lotto
// della pagina Firestore originale.

import { getDb, newId } from "@/lib/db";

export interface LottoApi {
  ProdottoId: string;
  Quantita: number;
  Marca: string | null;
  Modello: string | null;
  Misura: string | null;
  Stagione: string | null;
  StockSede: number | null;
}

export interface GabbiaApi {
  id: string;
  Codice: string | null;
  X: number | null;
  Y: number | null;
  Z: number | null;
  SedeId: string | null;
  SedeNome: string;
  QrCode: string | null;
  Prodotti: LottoApi[];
  PneumaticiIn: string[];
  PzTotali: number;
}

export interface GabbiaMatchApi {
  GabbiaId: string;
  Codice: string;
  SedeNome: string;
  Quantita: number;
}

type RawRef = { __ref?: string } | null | undefined;
type RawLotto = { Quantita?: number; Prodotto_Ref?: RawRef };

function extractProdottoId(ref: RawRef): string | null {
  const path = ref?.__ref;
  if (!path) return null;
  return path.split("/")[1] ?? null;
}

const STOCK_COLUMNS = ["stock_nola", "stock_nola_2", "stock_roma", "stock_volla", "stock_portici"] as const;
type StockColumn = (typeof STOCK_COLUMNS)[number];

function stockColumnForSede(sedeNome: string): StockColumn {
  const n = sedeNome.toLowerCase();
  if (n.includes("nola 2") || n.includes("nola2")) return "stock_nola_2";
  if (n.includes("nola")) return "stock_nola";
  if (n.includes("volla")) return "stock_volla";
  if (n.includes("roma")) return "stock_roma";
  if (n.includes("portici")) return "stock_portici";
  return "stock_nola";
}

function collectProdottoIds(rows: Record<string, unknown>[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    for (const l of (r.prodotti as RawLotto[]) ?? []) {
      const id = extractProdottoId(l.Prodotto_Ref);
      if (id) ids.add(id);
    }
    for (const p of (r.pneumatici_in as RawRef[]) ?? []) {
      const id = extractProdottoId(p);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

async function fetchProdottiInfo(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const db = getDb();
  if (!db || ids.length === 0) return new Map();
  const { rows } = await db.query(
    `SELECT id, marca, modello, larghezza, altezza, diametro, stagione,
            stock_nola, stock_nola_2, stock_roma, stock_volla, stock_portici
       FROM public.prodotti WHERE id = ANY($1)`,
    [ids]
  );
  return new Map(rows.map((r) => [r.id as string, r]));
}

function rowToGabbia(r: Record<string, unknown>, prodottiMap: Map<string, Record<string, unknown>>): GabbiaApi {
  const sedeNome = (r.sede_nome as string) ?? "—";
  const stockCol = stockColumnForSede(sedeNome);
  const rawProdotti = (r.prodotti as RawLotto[]) ?? [];

  const prodotti: LottoApi[] = rawProdotti.map((l) => {
    const pid = extractProdottoId(l.Prodotto_Ref);
    const info = pid ? prodottiMap.get(pid) : undefined;
    return {
      ProdottoId: pid ?? "",
      Quantita: l.Quantita ?? 0,
      Marca: (info?.marca as string) ?? null,
      Modello: (info?.modello as string) ?? null,
      Misura: info ? `${info.larghezza ?? "?"}/${info.altezza ?? "?"} R${info.diametro ?? "?"}` : null,
      Stagione: (info?.stagione as string) ?? null,
      StockSede: info ? ((info[stockCol] as number) ?? 0) : null,
    };
  });

  const pneumaticiIn = ((r.pneumatici_in as RawRef[]) ?? [])
    .map(extractProdottoId)
    .filter((x): x is string => !!x);

  // Stesso fallback della pagina originale: somma i lotti se `Prodotti`
  // esiste (anche vuoto → 0), altrimenti conta i riferimenti diretti.
  const pzTotali = r.prodotti != null
    ? prodotti.reduce((s, l) => s + (l.Quantita ?? 0), 0)
    : pneumaticiIn.length;

  return {
    id: r.id as string,
    Codice: (r.codice as string) ?? null,
    X: (r.x as number) ?? null,
    Y: (r.y as number) ?? null,
    Z: (r.z as number) ?? null,
    SedeId: (r.sede_id as string) ?? null,
    SedeNome: sedeNome,
    QrCode: (r.qr_code as string) ?? null,
    Prodotti: prodotti,
    PneumaticiIn: pneumaticiIn,
    PzTotali: pzTotali,
  };
}

const SELECT_BASE = `SELECT g.*, s.nome AS sede_nome FROM b2b.magazzino g LEFT JOIN core.sedi s ON s.id = g.sede_id`;

export async function listGabbie(): Promise<GabbiaApi[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(`${SELECT_BASE} ORDER BY g.codice`);
  const prodottiMap = await fetchProdottiInfo(collectProdottoIds(rows));
  return rows.map((r) => rowToGabbia(r, prodottiMap));
}

export async function getGabbia(id: string): Promise<GabbiaApi | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query(`${SELECT_BASE} WHERE g.id = $1`, [id]);
  if (!rows[0]) return null;
  const prodottiMap = await fetchProdottiInfo(collectProdottoIds(rows));
  return rowToGabbia(rows[0], prodottiMap);
}

export interface CreateGabbiaInput {
  codice: string;
  x: number;
  y: number;
  z: number;
  sedeId: string;
}

export async function createGabbia(input: CreateGabbiaInput): Promise<GabbiaApi> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const id = newId();
  await db.query(
    `INSERT INTO b2b.magazzino (id, codice, x, y, z, sede_id, gabbia, prodotti, pneumatici_in)
     VALUES ($1,$2,$3,$4,$5,$6,true,'[]'::jsonb,'[]'::jsonb)`,
    [id, input.codice, input.x, input.y, input.z, input.sedeId]
  );
  return (await getGabbia(id))!;
}

export async function addProdotto(gabbiaId: string, prodottoId: string, quantita: number): Promise<GabbiaApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const { rows } = await db.query(`SELECT prodotti, pneumatici_in FROM b2b.magazzino WHERE id = $1`, [gabbiaId]);
  if (!rows[0]) return null;

  const prodotti: RawLotto[] = rows[0].prodotti ?? [];
  const pneumaticiIn: RawRef[] = rows[0].pneumatici_in ?? [];
  const idx = prodotti.findIndex((l) => extractProdottoId(l.Prodotto_Ref) === prodottoId);

  let nextProdotti: RawLotto[];
  let nextPneumaticiIn = pneumaticiIn;
  if (idx !== -1) {
    nextProdotti = prodotti.map((l, i) => (i === idx ? { ...l, Quantita: (l.Quantita ?? 0) + quantita } : l));
  } else {
    nextProdotti = [...prodotti, { Quantita: quantita, Prodotto_Ref: { __ref: `Prodotti/${prodottoId}` } }];
    if (!pneumaticiIn.some((p) => extractProdottoId(p) === prodottoId)) {
      nextPneumaticiIn = [...pneumaticiIn, { __ref: `Prodotti/${prodottoId}` }];
    }
  }

  await db.query(
    `UPDATE b2b.magazzino SET prodotti = $2, pneumatici_in = $3 WHERE id = $1`,
    [gabbiaId, JSON.stringify(nextProdotti), JSON.stringify(nextPneumaticiIn)]
  );
  return getGabbia(gabbiaId);
}

export async function removeProdotto(gabbiaId: string, prodottoId: string): Promise<GabbiaApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const { rows } = await db.query(`SELECT prodotti, pneumatici_in FROM b2b.magazzino WHERE id = $1`, [gabbiaId]);
  if (!rows[0]) return null;

  const prodotti: RawLotto[] = rows[0].prodotti ?? [];
  const pneumaticiIn: RawRef[] = rows[0].pneumatici_in ?? [];
  const nextProdotti = prodotti.filter((l) => extractProdottoId(l.Prodotto_Ref) !== prodottoId);
  const stillReferenced = nextProdotti.some((l) => extractProdottoId(l.Prodotto_Ref) === prodottoId);
  const nextPneumaticiIn = stillReferenced ? pneumaticiIn : pneumaticiIn.filter((p) => extractProdottoId(p) !== prodottoId);

  await db.query(
    `UPDATE b2b.magazzino SET prodotti = $2, pneumatici_in = $3 WHERE id = $1`,
    [gabbiaId, JSON.stringify(nextProdotti), JSON.stringify(nextPneumaticiIn)]
  );
  return getGabbia(gabbiaId);
}

/** Cerca le gabbie che contengono un prodotto — sostituisce lo scan client-side dello scanner. */
export async function cercaGabbiePerProdotto(prodottoId: string): Promise<GabbiaMatchApi[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(
    `SELECT g.id, g.codice, s.nome AS sede_nome, lotto->>'Quantita' AS quantita
       FROM b2b.magazzino g
       LEFT JOIN core.sedi s ON s.id = g.sede_id
       CROSS JOIN LATERAL jsonb_array_elements(coalesce(g.prodotti, '[]'::jsonb)) AS lotto
      WHERE lotto->'Prodotto_Ref'->>'__ref' = $1`,
    [`Prodotti/${prodottoId}`]
  );
  return rows.map((r) => ({
    GabbiaId: r.id as string,
    Codice: (r.codice as string) ?? "—",
    SedeNome: (r.sede_nome as string) ?? "—",
    Quantita: Number(r.quantita ?? 0),
  }));
}
