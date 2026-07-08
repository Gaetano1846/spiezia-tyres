// Accesso Postgres al dominio Preventivi (Fase 6 — cutover app→Postgres).
// b2b.preventivi è ora la fonte autoritativa per le scritture: il bridge le
// propaga a Firestore (Clienti/{clienteId}/Preventivo/{id}), così il CRM
// FlutterFlow legacy continua a vederle.
//
// "Converti in Ordine" (handleConvertToOrder nella pagina di dettaglio) resta
// VOLUTAMENTE Firestore diretto — crea un documento in Ordini, dominio
// esplicitamente escluso da questa migrazione. Il bridge propaga comunque i
// campi Convertito/OrdineId che quella funzione scrive, verso fs_extra qui.
//
// Servizi/Totale/Iva/DataScadenza (scritti solo dalla pagina di modifica, mai
// popolati nei 123 preventivi reali campionati) non hanno colonne dedicate:
// vivono in fs_extra, che questo modulo legge/scrive con merge shallow
// (jsonb ||) così non serve una migration per un feature ancora a zero
// utilizzo reale — coerente con lo stesso principio già applicato a
// Ora_Inizio/Ora_Fine in fogliDb.ts.

import { getDb, newId } from "@/lib/db";

export interface ArticoloPreventivo {
  Marca?: string;
  Modello?: string;
  Misura?: string;
  Quantita?: number;
  PrezzoUnitario?: number;
  PFU?: number;
}

export interface PreventivoApi {
  id: string;
  ClienteId: string;
  ClienteNome: string;
  ClienteTelefono: string | null;
  ClienteEmail: string | null;
  ClienteCodiceFiscale: string | null;
  ClientePartitaIva: string | null;
  VeicoloId: string | null;
  VeicoloTarga: string | null;
  VeicoloMarca: string | null;
  VeicoloModello: string | null;
  VeicoloAnno: number | null;
  SedeId: string | null;
  OperatoreId: string | null;
  Numero: number | null;
  Data: string | null;
  DataCreazione: string | null;
  DataAccettazione: string | null;
  Accettato: boolean;
  Articoli: ArticoloPreventivo[];
  Note: string | null;
  PdfUrl: string | null;
  // Passthrough (vedi nota sopra) — letti da fs_extra, mai colonne dedicate.
  Servizi: unknown[];
  Totale: number | null;
  Iva: number | null;
  DataScadenza: string | null;
  OrdineId: string | null;
  Convertito: boolean;
  // Stato esteso ("Bozza"/"Rifiutato" oltre ad Accettato/In attesa) — la
  // pagina di modifica lo scrive come extra; Accettato resta la fonte di
  // verità strutturata (colonna reale), Stato è un dettaglio di visualizzazione.
  Stato: string | null;
}

function nomeClienteFrom(nome: string | null, ragioneSociale: string | null, azienda: boolean | null): string {
  if (azienda && ragioneSociale) return ragioneSociale;
  return nome?.trim() || ragioneSociale || "—";
}

function rowToPreventivo(r: Record<string, unknown>): PreventivoApi {
  const extra = (r.fs_extra as Record<string, unknown>) ?? {};
  return {
    id: r.id as string,
    ClienteId: r.cliente_id as string,
    ClienteNome: nomeClienteFrom(r.cliente_nome as string | null, r.cliente_ragione_sociale as string | null, r.cliente_azienda as boolean | null),
    ClienteTelefono: (r.cliente_telefono as string) ?? null,
    ClienteEmail: (r.cliente_email as string) ?? null,
    ClienteCodiceFiscale: (r.cliente_codice_fiscale as string) ?? null,
    ClientePartitaIva: (r.cliente_partita_iva as string) ?? null,
    VeicoloId: (r.veicolo_id as string) ?? null,
    VeicoloTarga: (r.veicolo_targa as string) ?? null,
    VeicoloMarca: (r.veicolo_marca as string) ?? null,
    VeicoloModello: (r.veicolo_modello as string) ?? null,
    VeicoloAnno: (r.veicolo_anno as number) ?? null,
    SedeId: (r.sede_id as string) ?? null,
    OperatoreId: (r.operatore_id as string) ?? null,
    Numero: (r.numero as number) ?? null,
    Data: (r.data as string) ?? null,
    DataCreazione: r.data_creazione ? (r.data_creazione as Date).toISOString() : null,
    DataAccettazione: r.data_accettazione ? (r.data_accettazione as Date).toISOString() : null,
    Accettato: (r.accettato as boolean) ?? false,
    Articoli: (r.articoli as ArticoloPreventivo[]) ?? [],
    Note: (r.note as string) ?? null,
    PdfUrl: (r.pdf_url as string) ?? null,
    Servizi: Array.isArray(extra.Servizi) ? (extra.Servizi as unknown[]) : [],
    Totale: typeof extra.Totale === "number" ? extra.Totale : null,
    Iva: typeof extra.IVA === "number" ? extra.IVA : null,
    DataScadenza: typeof extra.DataScadenza === "string" ? extra.DataScadenza : null,
    OrdineId: typeof extra.OrdineId === "string" ? extra.OrdineId : null,
    Convertito: extra.Convertito === true,
    Stato: typeof extra.Stato === "string" ? extra.Stato : null,
  };
}

const SELECT_BASE = `
  SELECT p.*, c.nome AS cliente_nome, c.ragione_sociale AS cliente_ragione_sociale,
         c.azienda AS cliente_azienda, c.telefono AS cliente_telefono, c.email AS cliente_email,
         c.codice_fiscale AS cliente_codice_fiscale, c.partita_iva AS cliente_partita_iva,
         v.targa AS veicolo_targa, v.marca AS veicolo_marca, v.modello AS veicolo_modello, v.anno AS veicolo_anno
    FROM b2b.preventivi p
    LEFT JOIN core.clienti c ON c.id = p.cliente_id
    LEFT JOIN b2b.veicoli v ON v.id = p.veicolo_id`;

export async function listPreventivi(limit = 200): Promise<PreventivoApi[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(`${SELECT_BASE} ORDER BY p.data_creazione DESC NULLS LAST LIMIT $1`, [limit]);
  return rows.map(rowToPreventivo);
}

export async function getPreventivo(clienteId: string, id: string): Promise<PreventivoApi | null> {
  const db = getDb();
  if (!db) return null;
  const { rows } = await db.query(`${SELECT_BASE} WHERE p.id = $1 AND p.cliente_id = $2`, [id, clienteId]);
  return rows[0] ? rowToPreventivo(rows[0]) : null;
}

export interface CreatePreventivoInput {
  clienteId: string;
  sedeId?: string | null;
  operatoreId?: string | null;
  veicoloId?: string | null;
  numero: number;
  data: string;
  articoli: ArticoloPreventivo[];
  note?: string | null;
}

export async function createPreventivo(input: CreatePreventivoInput): Promise<PreventivoApi> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const id = newId();
  await db.query(
    `INSERT INTO b2b.preventivi
       (id, cliente_id, sede_id, operatore_id, veicolo_id, numero, data,
        accettato, articoli, note, data_creazione)
     VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,$9,now())`,
    [id, input.clienteId, input.sedeId || null, input.operatoreId || null, input.veicoloId || null,
     input.numero, input.data, JSON.stringify(input.articoli), input.note || null]
  );
  return (await getPreventivo(input.clienteId, id))!;
}

export interface UpdatePreventivoInput {
  articoli: ArticoloPreventivo[];
  note: string | null;
  accettato: boolean;
  extra?: Record<string, unknown>; // Servizi/Totale/IVA/DataScadenza — merge shallow in fs_extra
}

export async function updatePreventivo(clienteId: string, id: string, input: UpdatePreventivoInput): Promise<PreventivoApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(
    `UPDATE b2b.preventivi SET
       articoli = $3, note = $4, accettato = $5,
       data_accettazione = CASE WHEN $5 THEN coalesce(data_accettazione, now()) ELSE NULL END,
       fs_extra = fs_extra || $6::jsonb
     WHERE id = $1 AND cliente_id = $2`,
    [id, clienteId, JSON.stringify(input.articoli), input.note, input.accettato, JSON.stringify(input.extra ?? {})]
  );
  return getPreventivo(clienteId, id);
}

export async function updatePreventivoStato(clienteId: string, id: string, accettato: boolean): Promise<PreventivoApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(
    `UPDATE b2b.preventivi SET
       accettato = $3,
       data_accettazione = CASE WHEN $3 THEN now() ELSE NULL END
     WHERE id = $1 AND cliente_id = $2`,
    [id, clienteId, accettato]
  );
  return getPreventivo(clienteId, id);
}

export async function updatePreventivoPdf(clienteId: string, id: string, pdfUrl: string): Promise<PreventivoApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(`UPDATE b2b.preventivi SET pdf_url = $3 WHERE id = $1 AND cliente_id = $2`, [id, clienteId, pdfUrl]);
  return getPreventivo(clienteId, id);
}
