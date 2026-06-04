import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Cache a livello di processo (non di modulo). In Next dev l'HMR ri-valuta questo
// modulo azzerando le variabili locali, ma il singleton interno di firebase-admin
// (la Firestore legata all'App) sopravvive: con una semplice `let _db` la cache
// tornava `null` mentre la Firestore era già inizializzata, quindi `settings()`
// lanciava "Firestore has already been initialized" → login 401 intermittente
// (falliva al primo tentativo, riusciva al retry). `globalThis` sopravvive all'HMR.
const adminGlobal = globalThis as unknown as { _adminDb?: Firestore };

function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0];

  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!clientEmail || !privateKey || !projectId) {
    throw new Error("Missing Firebase Admin env vars");
  }

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
}

export const adminAuth = () => getAuth(getAdminApp());

export const adminDb = (): Firestore => {
  if (adminGlobal._adminDb) return adminGlobal._adminDb;
  const db = getFirestore(getAdminApp());
  // gRPC non rispetta NODE_TLS_REJECT_UNAUTHORIZED su Windows — usa REST.
  // `settings()` è chiamabile una sola volta e solo prima di qualsiasi altra
  // operazione: lo proteggiamo perché in dev (HMR) la Firestore può risultare
  // già inizializzata da una precedente valutazione del modulo. In quel caso
  // riusiamo l'istanza esistente invece di far fallire l'intera richiesta.
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    try {
      db.settings({ preferRest: true });
    } catch {
      /* già inizializzata — manteniamo l'istanza esistente */
    }
  }
  adminGlobal._adminDb = db;
  return db;
};
