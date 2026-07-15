import { adminDb } from "@/lib/firebase-admin";

// Modulo condiviso (evita il ciclo prodottiDb <-> magazzinoDb, che già
// dipende da prodottiDb per stockColumnForSede). I lotti dentro
// b2b.magazzino.prodotti/pneumatici_in sono quasi tutti dati storici
// migrati as-is da Firestore Magazzino.pneumaticiIN/prodotti, che
// contenevano dei veri DocumentReference verso la collection Prodotti — il
// loro id è il doc ID Firestore, NON lo SKU di public.prodotti (catalogo
// diverso, stesso motivo documentato in
// lib/importers/tyre24PgWrite.js::resolveArticlesPg). Risolve un id
// "ambiguo" al suo SKU canonico leggendo il campo SKU del doc Firestore
// Prodotti/{id}, quando l'id non è già uno SKU diretto.
export async function resolveSkuFromFirestoreDocId(docId: string): Promise<string | null> {
  try {
    const snap = await adminDb().collection("Prodotti").doc(docId).get();
    if (!snap.exists) return null;
    const sku = snap.data()?.SKU;
    return typeof sku === "string" && sku.trim() ? sku.trim() : null;
  } catch (err) {
    console.error("[resolveSkuFromFirestoreDocId] fallito", err);
    return null;
  }
}
