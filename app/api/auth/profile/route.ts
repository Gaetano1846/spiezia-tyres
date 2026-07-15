import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUtenteProfile, updatePrinterMac, updateDisplayName, markUtentiAvvisati } from "@/lib/utentiDb";

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

// PATCH /api/auth/profile — self-service update di singoli campi del
// proprio profilo: PrinterMAC (selezione stampante Zebra, app Flutter
// magazzino) e DisplayName (nome visualizzato, pagina Account del sito).
// Nessun altro campo è scrivibile qui apposta (Ruolo/Sede/Blocco restano
// gestione admin).
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const printerMac = body?.PrinterMAC;
  const displayName = body?.DisplayName;
  const utentiAvvisati = body?.UtentiAvvisati;

  if (typeof printerMac !== "string" && typeof displayName !== "string" && utentiAvvisati !== true) {
    return NextResponse.json({ error: "PrinterMAC, DisplayName o UtentiAvvisati obbligatorio" }, { status: 400 });
  }

  if (typeof printerMac === "string") await updatePrinterMac(session.uid, printerMac);
  if (typeof displayName === "string") await updateDisplayName(session.uid, displayName);
  if (utentiAvvisati === true) await markUtentiAvvisati(session.uid);

  const profile = await getUtenteProfile(session.uid);
  if (!profile) return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });

  return NextResponse.json(profile);
}
