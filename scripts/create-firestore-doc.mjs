import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "fs";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const sa = JSON.parse(
  readFileSync("C:/Users/gaetano/Downloads/crm-3iuocs-firebase-adminsdk-rq14z-03879ae3b8.json", "utf-8")
);

initializeApp({ credential: cert(sa) });
const db = getFirestore();
const auth = getAuth();

const USERS = [
  { email: "admin@spieziatyres.it",     password: "Spiezia@Admin2025",  Ruolo: "Admin",        CRM: true  },
  { email: "crm@spieziatyres.it",       password: "Spiezia@CRM2025",    Ruolo: "Impiegato",    CRM: true  },
  { email: "gommista@spieziatyres.it",  password: "Spiezia@B2B2025",    Ruolo: "Gommista",     CRM: false },
  { email: "magazzino@spieziatyres.it", password: "Spiezia@Mag2025",    Ruolo: "Magazziniere", CRM: false },
];

for (const u of USERS) {
  try {
    let uid;
    try {
      const created = await auth.createUser({ email: u.email, password: u.password });
      uid = created.uid;
      console.log(`✓ Auth creato: ${u.email}`);
    } catch (e) {
      if (e.code === "auth/email-already-exists") {
        uid = (await auth.getUserByEmail(u.email)).uid;
        await auth.updateUser(uid, { password: u.password });
        console.log(`↺ Auth aggiornato: ${u.email} (uid: ${uid})`);
      } else throw e;
    }

    await db.collection("users").doc(uid).set(
      { email: u.email, Ruolo: u.Ruolo, CRM: u.CRM },
      { merge: true }
    );
    console.log(`  ✓ Firestore users/${uid} OK\n`);
  } catch (e) {
    console.error(`✗ ${u.email}:`, e.message);
  }
}

console.log("Done.");
process.exit(0);
