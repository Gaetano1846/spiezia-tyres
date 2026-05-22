import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

let _db: ReturnType<typeof getFirestore> | null = null;

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

export const adminDb = () => {
  if (_db) return _db;
  _db = getFirestore(getAdminApp());
  // gRPC non rispetta NODE_TLS_REJECT_UNAUTHORIZED su Windows — usa REST
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    _db.settings({ preferRest: true });
  }
  return _db;
};
