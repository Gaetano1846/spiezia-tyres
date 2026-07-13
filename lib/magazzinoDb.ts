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
import QRCode from "qrcode";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

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

export async function listGabbie(sedeId?: string): Promise<GabbiaApi[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = sedeId
    ? await db.query(`${SELECT_BASE} WHERE g.sede_id = $1 ORDER BY g.codice`, [sedeId])
    : await db.query(`${SELECT_BASE} ORDER BY g.codice`);
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

export async function updateGabbiaPosizione(id: string, pos: { x: number; y: number; z: number }): Promise<GabbiaApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(`UPDATE b2b.magazzino SET x = $2, y = $3, z = $4 WHERE id = $1`, [id, pos.x, pos.y, pos.z]);
  return getGabbia(id);
}

const OCCUPATO_COLUMN: Record<StockColumn, string> = {
  stock_nola: "stock_nola_occupato",
  stock_nola_2: "stock_nola_2_occupato",
  stock_roma: "stock_roma_occupato",
  stock_volla: "stock_volla_occupato",
  stock_portici: "stock_portici_occupato",
};

/**
 * Aggiunge (o incrementa) un prodotto in una gabbia + aggiorna in transazione
 * il contatore stock_*_occupato del prodotto per la sede della gabbia — porta
 * 1:1 della transazione Firestore `updateGabbia(add:true)` (custom action
 * Flutter, mai portata separatamente: la logica viveva solo lì).
 */
export async function addProdotto(gabbiaId: string, prodottoId: string, quantita: number): Promise<GabbiaApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `${SELECT_BASE} WHERE g.id = $1 FOR UPDATE OF g`,
      [gabbiaId]
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }

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

    await client.query(
      `UPDATE b2b.magazzino SET prodotti = $2, pneumatici_in = $3 WHERE id = $1`,
      [gabbiaId, JSON.stringify(nextProdotti), JSON.stringify(nextPneumaticiIn)]
    );

    const occupatoCol = OCCUPATO_COLUMN[stockColumnForSede((rows[0].sede_nome as string) ?? "—")];
    await client.query(
      `UPDATE public.prodotti SET ${occupatoCol} = ${occupatoCol} + $2 WHERE id = $1`,
      [prodottoId, quantita]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return getGabbia(gabbiaId);
}

/**
 * Rimuove (o decrementa) un prodotto da una gabbia + aggiorna in transazione
 * il contatore stock_*_occupato del prodotto per la sede della gabbia — porta
 * 1:1 delle transazioni Firestore `updateGabbia(add:false)`/`deleteFromGabbia`.
 */
export async function removeProdotto(gabbiaId: string, prodottoId: string, quantita?: number): Promise<GabbiaApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `${SELECT_BASE} WHERE g.id = $1 FOR UPDATE OF g`,
      [gabbiaId]
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }

    const prodotti: RawLotto[] = rows[0].prodotti ?? [];
    const pneumaticiIn: RawRef[] = rows[0].pneumatici_in ?? [];
    const idx = prodotti.findIndex((l) => extractProdottoId(l.Prodotto_Ref) === prodottoId);
    if (idx === -1) {
      await client.query("ROLLBACK");
      return getGabbia(gabbiaId);
    }

    const quantitaInGabbia = prodotti[idx].Quantita ?? 0;
    const rimuovi = quantita ?? quantitaInGabbia;

    let nextProdotti: RawLotto[];
    let nextPneumaticiIn = pneumaticiIn;
    if (quantitaInGabbia > rimuovi) {
      nextProdotti = prodotti.map((l, i) => (i === idx ? { ...l, Quantita: quantitaInGabbia - rimuovi } : l));
    } else {
      nextProdotti = prodotti.filter((_, i) => i !== idx);
      nextPneumaticiIn = pneumaticiIn.filter((p) => extractProdottoId(p) !== prodottoId);
    }

    await client.query(
      `UPDATE b2b.magazzino SET prodotti = $2, pneumatici_in = $3 WHERE id = $1`,
      [gabbiaId, JSON.stringify(nextProdotti), JSON.stringify(nextPneumaticiIn)]
    );

    const occupatoCol = OCCUPATO_COLUMN[stockColumnForSede((rows[0].sede_nome as string) ?? "—")];
    await client.query(
      `UPDATE public.prodotti SET ${occupatoCol} = GREATEST(${occupatoCol} - $2, 0) WHERE id = $1`,
      [prodottoId, rimuovi]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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

// ─── QR code — port 1:1 della Cloud Function `GenerateQR` (entry point reale
// `generateQrCodeZPL`, sorgente riscaricato da GCP; `generateZPLWithGraphic`/
// `extractGfFromFullLabel` nel sorgente originale sono dead code, mai
// chiamati dall'handler HTTP — non portati). Genera un PNG QR (libreria
// `qrcode`), lo converte in ZPL tramite l'API pubblica Labelary (terze parti,
// nessuna credenziale), lo centra in un'etichetta 10x10cm.
//
// Differenze dal sorgente CF originale:
//  - X/Y/Z letti da Postgres (b2b.magazzino) invece che da Firestore — il
//    dominio Magazzino è già Postgres-first dalla Fase 6e, questo era l'unica
//    lettura Firestore diretta rimasta in questa pagina.
//  - Il file .zpl va su disco locale VPS (/app/storage/public, servito da
//    nginx) invece che su GCS — stesso pattern di lib/bannerDb.ts.
//  - Scrive solo la colonna `qr_code` (le colonne di metadati dell'originale,
//    QR_code_generated_at/QR_target_link/QR_method/QR_image_info, non esistono
//    in b2b.magazzino e non sono lette da nessuna pagina).
const CM_PER_IN = 2.54;
function cmToDots(cm: number, dpi: number): number {
  return Math.round((cm / CM_PER_IN) * dpi);
}

async function labelaryGraphicsRawZpl(pngBuffer: Buffer): Promise<string> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(pngBuffer)], { type: "image/png" });
  form.append("file", blob, "qr.png");

  const res = await fetch("http://api.labelary.com/v1/graphics", {
    method: "POST",
    headers: { Accept: "application/zpl" },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Labelary error ${res.status}: ${text.slice(0, 200)}`);
  if (!text.includes("^GF")) throw new Error("Labelary response did not contain ^GF data.");
  return text;
}

function centerQRCodeInLabel(rawZpl: string, dpi = 203): string {
  const labelWidthDots = cmToDots(10, dpi);
  const labelHeightDots = cmToDots(10, dpi);
  const qrSizeDots = cmToDots(6, dpi);
  const centerX = Math.floor((labelWidthDots - qrSizeDots) / 2);
  const centerY = Math.floor((labelHeightDots - qrSizeDots) / 2);

  let graphicData = rawZpl;
  if (rawZpl.includes("^XA")) {
    const gfMatch = rawZpl.match(/\^GF[^]*?\^FS/);
    if (gfMatch) graphicData = gfMatch[0];
  }

  return `^XA\n^PW${labelWidthDots}\n^LS0\n^FO${centerX},${centerY}${graphicData}\n^XZ\n`;
}

/** Genera il QR ZPL per una gabbia, lo salva su disco, aggiorna `qr_code`. Ritorna la URL pubblica. */
export async function generateGabbiaQr(gabbiaId: string, link: string): Promise<string> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");

  const { rows } = await db.query(`SELECT x, y, z FROM b2b.magazzino WHERE id = $1`, [gabbiaId]);
  if (!rows[0]) throw new Error(`No Magazzino row found for id=${gabbiaId}`);
  const { x: X, y: Y, z: Z } = rows[0] as { x: number | null; y: number | null; z: number | null };
  if (typeof X !== "number" || typeof Y !== "number" || typeof Z !== "number") {
    throw new Error("Colonne x, y, z devono essere numeriche");
  }

  const dpi = 203;
  const desiredQrDots = cmToDots(5, dpi);
  const qrBuffer = await QRCode.toBuffer(link, { type: "png", width: desiredQrDots, margin: 4, errorCorrectionLevel: "M" });
  const rawZpl = await labelaryGraphicsRawZpl(qrBuffer);
  const zplCode = centerQRCodeInLabel(rawZpl, dpi);
  if (!zplCode.includes("^XA") || !zplCode.includes("^XZ")) throw new Error("Generated ZPL is invalid");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `X${X}_Y${Y}_Z${Z}_QR_${timestamp}.zpl`;
  const destDir = path.join("/app/storage", "public", "qrcodes");
  await mkdir(destDir, { recursive: true });
  await writeFile(path.join(destDir, fileName), zplCode, "utf8");

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://b2b2.spieziatyres.it";
  const publicUrl = `${baseUrl}/files/public/qrcodes/${fileName}`;

  await db.query(`UPDATE b2b.magazzino SET qr_code = $2 WHERE id = $1`, [gabbiaId, publicUrl]);
  return publicUrl;
}
