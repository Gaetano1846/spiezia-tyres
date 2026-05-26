import type { DocumentReference, Timestamp } from "firebase/firestore";

// ─── Auth / Users ─────────────────────────────────────────────────────────────

export type Ruolo =
  | "Admin"
  | "Magazziniere"
  | "Gommista"
  | "Grossista"
  | "Privato"
  | "T24"
  | "Rappresentante"
  | "Impiegato";

export type AppUser = {
  uid: string;
  email: string;
  displayName?: string;
  Ruolo: Ruolo;
  CRM: boolean;
  Sede?: DocumentReference | null;
  SedeNome?: string;            // nome sede risolto (es. "Nola", "Roma")
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
  Stagione?: string[];
  Raggio?: string[];
  Clienti: DocumentReference[];
  Attiva: boolean;
  Scadenza: Timestamp;
  Fisso: boolean;
  Importo?: number;
  Sconto?: number; // legacy alias for Importo
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
// Campi reali su Firestore (schema Flutter originale)

export type Cliente = {
  id: string;
  Nome?: string;              // nome persona fisica
  Ragione_Sociale?: string;   // nome azienda
  Azienda?: boolean;          // true = è un'azienda, false = persona fisica
  Email?: string;
  Telefono?: string;
  Via?: string;
  Citta?: string;
  CAP?: string;
  Partita_Iva?: string;
  Codice_Fiscale?: string;
  PEC?: string;
  Tipo?: string;              // "Privato" | "Gommista" | "Officina" | "Grossista" ecc.
  B2B?: boolean;
  Fido?: number;
  Fido_Residuo?: number;
  Paese?: string;
  Source?: string;
  Locale?: boolean;
  Sede?: DocumentReference;
  Metodo_di_Pagamento?: string;
  Note?: string;
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
// Campi reali su Firestore (schema Flutter originale)

export type PneumaticoPrev = {
  Marca?: string;
  Modello?: string;
  Misura?: string;
  Quantita?: number;
  PrezzoUnitario?: number;
};

export type Preventivo = {
  id: string;
  ID?: number;                        // numero sequenziale (1, 2, 3 …)
  Data?: string;                      // data come stringa "dd/MM/yyyy"
  Data_Creazione?: Timestamp;
  Data_Accettazione?: Timestamp;
  Accettato?: boolean;
  Operatore?: DocumentReference;
  Veicolo?: DocumentReference | null;
  Sede?: DocumentReference | null;
  PDF_URL?: string;
  Pneumatici_Nuovi?: PneumaticoPrev[];
  // Il cliente è il parent del parent (Clienti/{id}/Preventivo/{docId})
  // Non è un campo nel documento — viene risolto via _clienteId
};

export type ServizioOrdine = {
  Servizio: DocumentReference;
  Titolo: string;
  Prezzo: number;
  Quantita: number;
};

// ServiziStruct — embedded in Foglio_di_Lavoro.Servizi (actual Firestore schema)
export type ServiziItem = {
  Nome: string;
  Quantita: number;
  Selected: boolean;
  Tipo: string;   // "Pneumatico" | "Veicolo"
  Ordine: number;
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

// PneumaticiStruct — embedded in Foglio_di_Lavoro (actual Firestore field names)
export type Pneumatico = {
  Titolo?: string;
  Marca?: string;
  Modello?: string;
  Stagione?: string;
  Quantita?: number;
  Usura?: number;
  Prezzo?: number;
  KM_totali?: number;
  Immagine?: string;
  PFU?: number;
  Prezzo_Totale?: number;
  Misura?: string;  // extra field written by the create form (not in Flutter schema)
};

export type FoglioDiLavoro = {
  id: string;
  ID?: number;                          // numeric foglio number
  Cliente?: DocumentReference | null;
  Veicolo?: DocumentReference | null;
  Operatore?: DocumentReference | null;
  Accettatore?: DocumentReference | null;
  Sede?: DocumentReference | null;
  Stato: FoglioStato;
  DataOra?: Timestamp;                  // creation timestamp (primary)
  Data_Creazione?: Timestamp;           // secondary date
  DataCompletamento?: Timestamp;
  Pneumatici_Montati?: Pneumatico[];    // underscore naming from Flutter
  Pneumatici_Smontati?: Pneumatico[];
  Servizi?: ServiziItem[];
  Note?: string;
  URL?: string;
};

// ─── Magazzino ────────────────────────────────────────────────────────────────

export type LottoMagazzino = {
  Quantita: number;
  Prodotto_Ref: DocumentReference;
};

export type Gabbia = {
  id: string;
  ID: string;               // codice posizione, es. "A-1-3"
  X?: number;
  Y?: number;
  Z?: number;
  Sede?: DocumentReference;
  QR_code?: string;
  Gabbia?: boolean;
  Prodotti?: LottoMagazzino[];       // array embedded con Quantita + Prodotto_Ref
  Pneumatici_IN?: DocumentReference[]; // array di ref prodotti
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
