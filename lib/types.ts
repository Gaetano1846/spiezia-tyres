import type { DocumentReference, Timestamp } from "firebase/firestore";

// ─── Auth / Users ─────────────────────────────────────────────────────────────

export type Ruolo = "Admin" | "Magazziniere" | "Gommista" | "Grossista" | "Privato" | "T24";

export type AppUser = {
  uid: string;
  email: string;
  displayName?: string;
  Ruolo: Ruolo;
  CRM: boolean;
  Sede?: DocumentReference | null;
  Reparto?: DocumentReference | null;
  Mansione?: DocumentReference | null;
  Fido?: number;
  Fido_Residuo?: number;
  utentiAvvisati?: boolean;
  createdAt?: Timestamp;
  lastLogin?: Timestamp;
};

// ─── Indirizzo ─────────────────────────────────────────────────────────────────

export type Indirizzo = {
  Nome: string;
  Cognome: string;
  Azienda?: string;
  Via: string;
  Civico: string;
  CAP: string;
  Citta: string;
  Provincia: string;
  Paese: string;
  Telefono?: string;
  PEC?: string;
  CodiceFiscale?: string;
  PartitaIVA?: string;
  CodiceSDI?: string;
};

// ─── Prodotto (from Algolia / Firestore Prodotti) ─────────────────────────────

export type Stagione = "Estive" | "Invernali" | "4-Stagioni";
export type Categoria = "Auto" | "SUV" | "Moto" | "Furgone";

export type Prodotto = {
  id: string;
  titolo: string;
  marca: string;
  modello: string;
  larghezza: string;
  altezza: string;
  diametro: string;
  indiceCarico: string;
  indiceVelocita: string;
  stagione: Stagione;
  categoria: Categoria;
  immagine: string;
  prezzo: number;
  prezzoPrecedente?: number;
  pfu: number;
  stock: number;
  rating: number;
  recensioni: number;
  indiceBagnato: string;
  indiceConsumo: string;
  indiceRumorosita: string;
  ean: string;
  sku: string;
  t24: boolean;
};

// ─── Carrello ─────────────────────────────────────────────────────────────────

export type RigaCarrello = {
  prodottoId: string;
  titolo: string;
  marca: string;
  immagine: string;
  prezzo: number;
  pfu: number;
  quantita: number;
  t24: boolean;
};

// ─── Promozione ───────────────────────────────────────────────────────────────

export type Promozione = {
  id: string;
  Brand_Nome: string[];
  Clienti: DocumentReference[];
  Attiva: boolean;
  Scadenza: Timestamp;
  Fisso: boolean;
  Sconto: number;
};

// ─── Ordine ───────────────────────────────────────────────────────────────────

export type OrdineSource = "B2B" | "eBay" | "Amazon" | "WooCommerce";
export type OrdineStato =
  | "In attesa di pagamento"
  | "Confermato"
  | "In lavorazione"
  | "Spedito"
  | "Consegnato"
  | "Annullato"
  | "Rimborsato";

export type ArticoloOrdine = {
  Prodotto: string;
  Titolo: string;
  Marca: string;
  Quantita: number;
  PrezzoUnitario: number;
  PFU: number;
  contributoLogistico?: number;
  T24?: boolean;
  wCItemID?: string;
};

export type Pagamento = {
  Metodo: string;
  Stato: string;
  Riferimento?: string;
  Data?: Timestamp;
};

export type SpeseExtra = {
  Descrizione: string;
  Importo: number;
};

export type Ordine = {
  id: string;
  Numero: string;
  Utente: DocumentReference;
  Cliente?: DocumentReference | null;
  Source: OrdineSource;
  Stato: OrdineStato;
  Articoli: ArticoloOrdine[];
  Totale: number;
  IVA: number;
  PFU: number;
  SpeseExtra?: SpeseExtra[];
  Pagamento?: Pagamento;
  IndirizzoFatturazione?: Indirizzo;
  IndirizzoSpedizione?: Indirizzo;
  Note?: string;
  DataCreazione: Timestamp;
  DataAggiornamento?: Timestamp;
  eBay_OrderID?: string;
  Amazon_MarketplaceID?: string;
  WC_OrderNumber?: string;
  Tracking?: string;
  CorriereLogo?: string;
};

// ─── Cliente ──────────────────────────────────────────────────────────────────

export type Cliente = {
  id: string;
  Nome: string;
  Cognome: string;
  Email: string;
  Telefono?: string;
  Azienda?: string;
  PartitaIVA?: string;
  CodiceFiscale?: string;
  Fido?: number;
  Fido_Residuo?: number;
  Note?: string;
  DataCreazione?: Timestamp;
};

export type Veicolo = {
  id: string;
  Targa: string;
  Marca: string;
  Modello: string;
  Anno?: number;
  Km?: number;
  Note?: string;
};

// ─── Preventivo ───────────────────────────────────────────────────────────────

export type PreventivoStato = "Bozza" | "Inviato" | "Accettato" | "Rifiutato" | "Scaduto";

export type Preventivo = {
  id: string;
  Numero: string;
  Cliente: DocumentReference;
  Veicolo?: DocumentReference | null;
  Stato: PreventivoStato;
  Articoli: ArticoloOrdine[];
  Servizi?: ServizioOrdine[];
  Totale: number;
  IVA: number;
  PFU: number;
  Note?: string;
  DataCreazione: Timestamp;
  DataScadenza?: Timestamp;
  DataConversione?: Timestamp;
  OrdineRef?: DocumentReference | null;
};

export type ServizioOrdine = {
  Servizio: DocumentReference;
  Titolo: string;
  Prezzo: number;
  Quantita: number;
};

// ─── Appuntamento ─────────────────────────────────────────────────────────────

export type AppuntamentoStato = "Programmato" | "Completato" | "Annullato";

export type Appuntamento = {
  id: string;
  Cliente: DocumentReference;
  Veicolo?: DocumentReference | null;
  Operatore?: DocumentReference | null;
  Sede: DocumentReference;
  Stato: AppuntamentoStato;
  DataOra: Timestamp;
  Durata: number;
  Note?: string;
  Servizi?: ServizioOrdine[];
};

// ─── Foglio di Lavoro ─────────────────────────────────────────────────────────

export type FoglioStato = "Aperto" | "In lavorazione" | "Completato";

export type Lotto = {
  Posizione: string;
  Quantita: number;
  Note?: string;
};

export type Pneumatico = {
  Marca: string;
  Modello: string;
  Misura: string;
  Stagione: Stagione;
  Quantita: number;
  Stato?: string;
};

export type FoglioDiLavoro = {
  id: string;
  Numero: string;
  Cliente: DocumentReference;
  Veicolo: DocumentReference;
  Operatore?: DocumentReference | null;
  Sede: DocumentReference;
  Stato: FoglioStato;
  DataCreazione: Timestamp;
  DataCompletamento?: Timestamp;
  PneumaticiMontati?: Pneumatico[];
  PneumaticiSmontati?: Pneumatico[];
  Servizi?: ServizioOrdine[];
  Note?: string;
  PDF?: string;
};

// ─── Magazzino ────────────────────────────────────────────────────────────────

export type Gabbia = {
  id: string;
  Posizione: string;
  Sede: DocumentReference;
  Pneumatici?: Pneumatico[];
  Lotti?: Lotto[];
  Note?: string;
};

// ─── Notifica ─────────────────────────────────────────────────────────────────

export type Notifica = {
  id: string;
  Titolo: string;
  Testo: string;
  Tipo: "ordine" | "preventivo" | "appuntamento" | "sistema";
  Visto: boolean;
  Link?: string;
  DataCreazione: Timestamp;
};

// ─── Sede / Config ────────────────────────────────────────────────────────────

export type Sede = {
  id: string;
  Nome: string;
  Indirizzo?: string;
  Telefono?: string;
};

// ─── Auth session (server-side cookie payload) ────────────────────────────────

export type SessionPayload = {
  uid: string;
  email: string;
  Ruolo: Ruolo;
  CRM: boolean;
};
