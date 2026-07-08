// Accesso Postgres al dominio Fogli di Lavoro (Fase 6 — cutover app→Postgres).
// b2b.fogli_di_lavoro è ora la fonte autoritativa per le scritture: il bridge
// le propaga a Firestore, così il CRM FlutterFlow legacy continua a vederle.
//
// Numero progressivo (colonna `numero`): allocato lato client via
// nextCounter("FoglioDiLavoro", sedeId) — Firestore resta l'unico allocatore
// finché il bridge è vivo (vedi lib/counters.ts). Questo modulo riceve il
// numero già allocato, non lo genera.
//
// Operatore: resta risolto lato Firestore (collection "users", non ancora
// migrata) — stesso pattern di lib/appuntamentiDb.ts.

import { getDb, newId } from "@/lib/db";

export type PneumaticoFoglio = {
  Titolo?: string; Marca?: string; Modello?: string; Stagione?: string;
  Quantita?: number; Usura?: number; Prezzo?: number; KM_totali?: number;
  Immagine?: string; PFU?: number; Prezzo_Totale?: number; Misura?: string;
};

export type ServizioFoglio = {
  Nome?: string; Quantita?: number; Selected?: boolean; Tipo?: string; Ordine?: number;
};

export interface FoglioApi {
  id: string;
  Numero: number | null;
  ClienteId: string | null;
  ClienteNome: string;
  ClienteTelefono: string | null;
  ClienteEmail: string | null;
  VeicoloId: string | null;
  VeicoloTarga: string | null;
  VeicoloMarca: string | null;
  VeicoloModello: string | null;
  VeicoloAnno: number | null;
  VeicoloKm: number | null;
  OperatoreId: string | null;
  SedeId: string | null;
  SedeNome: string;
  Stato: string;
  DataOra: string | null;
  DataCreazione: string | null;
  DataCompletamento: string | null;
  PneumaticiMontati: PneumaticoFoglio[];
  PneumaticiSmontati: PneumaticoFoglio[];
  Servizi: ServizioFoglio[];
  Note: string | null;
  PdfUrl: string | null;
}

function nomeClienteFrom(nome: string | null, ragioneSociale: string | null, azienda: boolean | null): string {
  if (azienda && ragioneSociale) return ragioneSociale;
  return nome?.trim() || ragioneSociale || "—";
}

function rowToFoglio(r: Record<string, unknown>): FoglioApi {
  return {
    id: r.id as string,
    Numero: (r.numero as number) ?? null,
    ClienteId: (r.cliente_id as string) ?? null,
    ClienteNome: nomeClienteFrom(r.cliente_nome as string | null, r.cliente_ragione_sociale as string | null, r.cliente_azienda as boolean | null),
    ClienteTelefono: (r.cliente_telefono as string) ?? null,
    ClienteEmail: (r.cliente_email as string) ?? null,
    VeicoloId: (r.veicolo_id as string) ?? null,
    VeicoloTarga: (r.veicolo_targa as string) ?? null,
    VeicoloMarca: (r.veicolo_marca as string) ?? null,
    VeicoloModello: (r.veicolo_modello as string) ?? null,
    VeicoloAnno: (r.veicolo_anno as number) ?? null,
    VeicoloKm: (r.veicolo_km as number) ?? null,
    OperatoreId: (r.operatore_id as string) ?? null,
    SedeId: (r.sede_id as string) ?? null,
    SedeNome: (r.sede_nome as string) ?? "—",
    Stato: (r.stato as string) ?? "Aperto",
    DataOra: r.data_ora ? (r.data_ora as Date).toISOString() : null,
    DataCreazione: r.data_creazione ? (r.data_creazione as Date).toISOString() : null,
    DataCompletamento: r.data_completamento ? (r.data_completamento as Date).toISOString() : null,
    PneumaticiMontati: (r.pneumatici_montati as PneumaticoFoglio[]) ?? [],
    PneumaticiSmontati: (r.pneumatici_smontati as PneumaticoFoglio[]) ?? [],
    Servizi: (r.servizi as ServizioFoglio[]) ?? [],
    Note: (r.note as string) ?? null,
    PdfUrl: (r.pdf_url as string) ?? null,
  };
}

const SELECT_BASE = `
  SELECT f.*, c.nome AS cliente_nome, c.ragione_sociale AS cliente_ragione_sociale,
         c.azienda AS cliente_azienda, c.telefono AS cliente_telefono, c.email AS cliente_email,
         v.targa AS veicolo_targa, v.marca AS veicolo_marca, v.modello AS veicolo_modello,
         v.anno AS veicolo_anno, v.km AS veicolo_km, s.nome AS sede_nome
    FROM b2b.fogli_di_lavoro f
    LEFT JOIN core.clienti c ON c.id = f.cliente_id
    LEFT JOIN b2b.veicoli v ON v.id = f.veicolo_id
    LEFT JOIN core.sedi s ON s.id = f.sede_id`;

export async function listFogli(limit = 300): Promise<FoglioApi[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(
    `${SELECT_BASE} ORDER BY coalesce(f.data_ora, f.data_creazione) DESC NULLS LAST LIMIT $1`,
    [limit]
  );
  return rows.map(rowToFoglio);
}

export async function getFoglio(id: string): Promise<FoglioApi | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query(`${SELECT_BASE} WHERE f.id = $1`, [id]);
  return rows[0] ? rowToFoglio(rows[0]) : null;
}

export interface FoglioInput {
  clienteId: string;
  sedeId: string;
  veicoloId?: string | null;
  operatoreId?: string | null;
  numero?: number | null;
  stato?: string;
  pneumaticiMontati?: PneumaticoFoglio[];
  pneumaticiSmontati?: PneumaticoFoglio[];
  note?: string | null;
}

export async function createFoglio(input: FoglioInput): Promise<FoglioApi> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const id = newId();
  await db.query(
    `INSERT INTO b2b.fogli_di_lavoro
       (id, numero, cliente_id, sede_id, veicolo_id, operatore_id, stato,
        pneumatici_montati, pneumatici_smontati, note, data_ora, data_creazione)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())`,
    [id, input.numero ?? null, input.clienteId, input.sedeId, input.veicoloId || null,
     input.operatoreId || null, input.stato ?? "Aperto",
     input.pneumaticiMontati ? JSON.stringify(input.pneumaticiMontati) : null,
     input.pneumaticiSmontati ? JSON.stringify(input.pneumaticiSmontati) : null,
     input.note || null]
  );
  return (await getFoglio(id))!;
}

export async function updateFoglio(id: string, input: FoglioInput): Promise<FoglioApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(
    `UPDATE b2b.fogli_di_lavoro SET
       cliente_id = $2, sede_id = $3, veicolo_id = $4, stato = coalesce($5, stato),
       pneumatici_montati = $6, pneumatici_smontati = $7, note = $8
     WHERE id = $1`,
    [id, input.clienteId, input.sedeId, input.veicoloId || null, input.stato ?? null,
     input.pneumaticiMontati ? JSON.stringify(input.pneumaticiMontati) : null,
     input.pneumaticiSmontati ? JSON.stringify(input.pneumaticiSmontati) : null,
     input.note || null]
  );
  return getFoglio(id);
}

export async function updateFoglioStato(id: string, stato: string): Promise<FoglioApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(
    `UPDATE b2b.fogli_di_lavoro SET
       stato = $2, data_completamento = CASE WHEN $2 = 'Completato' THEN now() ELSE data_completamento END
     WHERE id = $1`,
    [id, stato]
  );
  return getFoglio(id);
}

export async function updateFoglioPdf(id: string, pdfUrl: string): Promise<FoglioApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(`UPDATE b2b.fogli_di_lavoro SET pdf_url = $2 WHERE id = $1`, [id, pdfUrl]);
  return getFoglio(id);
}
