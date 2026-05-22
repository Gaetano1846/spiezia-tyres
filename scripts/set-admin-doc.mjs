import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "fs";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const sa = JSON.parse(readFileSync("C:/Users/gaetano/Downloads/crm-3iuocs-firebase-adminsdk-rq14z-03879ae3b8.json", "utf-8"));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

// UID confermato dallo script precedente
await db.collection("users").doc("9fQepgzpCWeDle8wH0W8bSLnIhR2").set({
  email: "admin@spieziatyres.it",
  Ruolo: "Admin",
  CRM: true,
}, { merge: true });

console.log("✓ Firestore users/9fQepgzpCWeDle8wH0W8bSLnIhR2 scritto");
process.exit(0);
