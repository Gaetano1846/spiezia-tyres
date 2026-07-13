import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUtenteProfile } from "@/lib/utentiDb";

export const runtime = "nodejs";

// GET /api/auth/profile — profilo esteso dell'utente autenticato (Sede,
// Reparto, PrinterMAC, ecc.). getSession()/SessionPayload porta solo
// {uid,email,Ruolo,CRM}; qui si aggiungono i campi che nel vecchio doc
// Firestore `users/{uid}` servivano ai client nativi (app Flutter magazzino,
// che non ha più accesso diretto a Firestore). Nessun parametro id: si legge
// sempre e solo il profilo del chiamante autenticato.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const profile = await getUtenteProfile(session.uid);
  if (!profile) return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });

  return NextResponse.json(profile);
}
