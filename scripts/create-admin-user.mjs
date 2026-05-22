import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "module";
import { readFileSync } from "fs";

const sa = JSON.parse(
  readFileSync("C:/Users/gaetano/Downloads/crm-3iuocs-firebase-adminsdk-rq14z-03879ae3b8.json", "utf-8")
);

initializeApp({ credential: cert(sa) });

const auth = getAuth();
const db = getFirestore();

const USERS = [
  { email: "admin@spieziatyres.it",      password: "Spiezia@Admin2025",    Ruolo: "Admin",        CRM: true,  nome: "Admin" },
  { email: "crm@spieziatyres.it",        password: "Spiezia@CRM2025",      Ruolo: "Impiegato",    CRM: true,  nome: "Operatore CRM" },
  { email: "gommista@spieziatyres.it",   password: "Spiezia@B2B2025",      Ruolo: "Gommista",     CRM: false, nome: "Cliente B2B" },
  { email: "magazzino@spieziatyres.it",  password: "Spiezia@Mag2025",      Ruolo: "Magazziniere", CRM: false, nome: "Magazziniere" },
];

for (const u of USERS) {
  try {
    // Prova a creare — se esiste già, recupera l'UID esistente
    let uid;
    try {
      const created = await auth.createUser({ email: u.email, password: u.password, displayName: u.nome });
      uid = created.uid;
      console.log(`✓ Creato: ${u.email}`);
    } catch (e) {
      if (e.code === "auth/email-already-exists") {
        const existing = await auth.getUserByEmail(u.email);
        uid = existing.uid;
        await auth.updateUser(uid, { password: u.password, displayName: u.nome });
        console.log(`↺ Aggiornato: ${u.email}`);
      } else throw e;
    }

    await db.collection("users").doc(uid).set({
      email: u.email,
      Ruolo: u.Ruolo,
      CRM: u.CRM,
      Nome: u.nome,
    }, { merge: true });

    console.log(`  Firestore users/${uid} → Ruolo=${u.Ruolo} CRM=${u.CRM}`);
  } catch (e) {
    console.error(`✗ ${u.email}: ${e.message}`);
  }
}

console.log("\nDone.");
process.exit(0);
