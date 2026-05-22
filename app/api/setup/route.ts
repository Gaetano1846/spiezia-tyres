import { NextResponse } from "next/server";

// Endpoint temporaneo — crea documenti Firestore per gli utenti test.
// RIMUOVERE prima del deploy in produzione.

const ADMIN_CONFIGURED = !!(
  process.env.FIREBASE_ADMIN_CLIENT_EMAIL && process.env.FIREBASE_ADMIN_PRIVATE_KEY
);

export async function GET() {
  if (!ADMIN_CONFIGURED) {
    return NextResponse.json({ error: "Admin SDK non configurato" }, { status: 503 });
  }

  try {
    const { adminAuth, adminDb } = await import("@/lib/firebase-admin");

    // UID già noti — scrittura diretta senza lookup Auth (più veloce)
    const users = [
      { uid: "9fQepgzpCWeDle8wH0W8bSLnIhR2", email: "admin@spieziatyres.it",     Ruolo: "Admin",        CRM: true  },
      { uid: "eJex3KOwmYgPU6BPHh92JebuhbH3", email: "crm@spieziatyres.it",       Ruolo: "Impiegato",    CRM: true  },
      { uid: "fSaiO78AN5RjOG9kuOhzEMbM0MJ2", email: "gommista@spieziatyres.it",  Ruolo: "Gommista",     CRM: false },
      { uid: "M4f9BGVXZDTrhQqmxSRlMCfx07i2", email: "magazzino@spieziatyres.it", Ruolo: "Magazziniere", CRM: false },
    ];

    const batch = adminDb().batch();
    for (const u of users) {
      batch.set(
        adminDb().collection("users").doc(u.uid),
        { email: u.email, Ruolo: u.Ruolo, CRM: u.CRM },
        { merge: true }
      );
    }
    await batch.commit();

    return NextResponse.json({ ok: true, users });
  } catch (err) {
    console.error("[setup]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
