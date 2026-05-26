import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  Timestamp,
} from "firebase/firestore";
import type { Promozione } from "@/lib/types";
import type { CartItem } from "@/lib/cart";

// ─── Fetch promozioni attive per un utente ────────────────────────────────────

/**
 * Recupera le promozioni attive e non scadute che includono l'utente.
 * Richiede l'uid per costruire il DocumentReference usato nel where.
 */
export async function fetchPromozioniUtente(uid: string): Promise<Promozione[]> {
  try {
    const userRef = doc(db, "users", uid);
    const now = Timestamp.now();

    const q = query(
      collection(db, "Promozione"),
      where("Clienti", "array-contains", userRef),
      where("Attiva", "==", true),
      where("Scadenza", ">=", now)
    );

    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Promozione));
  } catch {
    return [];
  }
}

// ─── Applica promozioni a un singolo CartItem ─────────────────────────────────

export type ScontoApplicato = {
  promoId: string;
  brandMatch: string;
  importo: number;       // valore sconto in € (già calcolato)
  fisso: boolean;        // true = importo fisso, false = percentuale
};

/**
 * Trova e applica la migliore promozione applicabile a un articolo del carrello.
 * Logica Flutter: Brand_Nome match (case-insensitive), opzionale Stagione / Raggio.
 * Fisso=true → sconto fisso in €; Fisso=false → moltiplicatore (es. Importo=0.9 → -10%).
 *
 * Restituisce il prezzo scontato e la promozione applicata (se trovata).
 */
export function applicaPromozione(
  item: CartItem,
  promozioni: Promozione[]
): { prezzoScontato: number; sconto: ScontoApplicato | null } {
  const marcaNorm = item.marca.trim().toLowerCase();

  for (const promo of promozioni) {
    // Controlla match marca
    const brandMatch = promo.Brand_Nome?.some(
      (b) => b.trim().toLowerCase() === marcaNorm
    );
    if (!brandMatch) continue;

    // Controlla match stagione (opzionale)
    if (promo.Stagione && promo.Stagione.length > 0) {
      const stageNorm = item.stagione.trim().toLowerCase();
      const stageMatch = promo.Stagione.some(
        (s) => s.trim().toLowerCase() === stageNorm
      );
      if (!stageMatch) continue;
    }

    // Controlla match raggio/diametro (opzionale)
    // Il CartItem ha misura come stringa es. "205/55R16" — estraiamo R + raggio
    if (promo.Raggio && promo.Raggio.length > 0) {
      const raggioMatch = promo.Raggio.some((r) =>
        item.misura.toUpperCase().includes(`R${r}`)
      );
      if (!raggioMatch) continue;
    }

    const importoRaw = promo.Importo ?? promo.Sconto ?? 0;
    let prezzoScontato: number;
    let importoSconto: number;

    if (promo.Fisso) {
      // Sconto fisso in €
      importoSconto = importoRaw;
      prezzoScontato = Math.max(0, item.prezzo - importoSconto);
    } else {
      // Moltiplicatore (es. 0.9 = -10%, 0.85 = -15%)
      prezzoScontato = item.prezzo * importoRaw;
      importoSconto = item.prezzo - prezzoScontato;
    }

    return {
      prezzoScontato: parseFloat(prezzoScontato.toFixed(4)),
      sconto: {
        promoId: promo.id,
        brandMatch: item.marca,
        importo: parseFloat(importoSconto.toFixed(2)),
        fisso: promo.Fisso,
      },
    };
  }

  return { prezzoScontato: item.prezzo, sconto: null };
}

// ─── Calcola totali con sconti ────────────────────────────────────────────────

export type CartTotalsConSconto = {
  subtotale: number;
  scontoTotale: number;
  subtotaleScontato: number;
  pfu: number;
  contributoLogistico: number;
  iva: number;
  totale: number;
};

export const CONTRIBUTO_LOGISTICO_UNIT = 0.95;

export function calcolaTotaliConSconto(
  items: CartItem[],
  promozioni: Promozione[]
): CartTotalsConSconto {
  let subtotale = 0;
  let scontoTotale = 0;
  let pfu = 0;
  const totalePneumatici = items.reduce((s, i) => s + i.quantita, 0);

  for (const item of items) {
    const { prezzoScontato, sconto } = applicaPromozione(item, promozioni);
    subtotale += item.prezzo * item.quantita;
    scontoTotale += sconto ? sconto.importo * item.quantita : 0;
    pfu += item.pfu * item.quantita;
    // prezzoScontato usato solo per il subtotaleScontato
    void prezzoScontato;
  }

  // Ricalcola con prezzi scontati per il subtotale netto
  const subtotaleScontato = items.reduce((s, item) => {
    const { prezzoScontato } = applicaPromozione(item, promozioni);
    return s + prezzoScontato * item.quantita;
  }, 0);

  const contributoLogistico = totalePneumatici * CONTRIBUTO_LOGISTICO_UNIT;
  const base = subtotaleScontato + pfu + contributoLogistico;
  const iva = base * 0.22;
  const totale = base * 1.22;

  return {
    subtotale,
    scontoTotale: parseFloat(scontoTotale.toFixed(2)),
    subtotaleScontato: parseFloat(subtotaleScontato.toFixed(2)),
    pfu,
    contributoLogistico,
    iva,
    totale,
  };
}
