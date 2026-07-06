import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { getSession, isCRM } from "@/lib/auth";
import type { DocumentReference } from "firebase-admin/firestore";

// ─── Crea anagrafica Cliente ───────────────────────────────────────────────────
// Replica del `crea_cliente` FlutterFlow: crea SOLO un documento nella collezione
// `Clienti` (nessun account di login). Scrittura lato server con firebase-admin
// così funziona sia con auth Firebase reale sia in modalità solo-cookie di sessione
// (in cui una addDoc client-side verrebbe negata dalle regole `isAdmin() || isCRM()`).
//
// Default fedeli a FlutterFlow: B2B=false, Locale=true, ID='', Sede = sede
// dell'operatore che crea. Controllo anti-duplicato per Email (come il flag
// `clienteEsiste` che, nel form Flutter, bloccava il salvataggio).

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }

  const nome = str(body.Nome);
  const ragioneSociale = str(body.Ragione_Sociale);
  const email = str(body.Email);
  const telefono = str(body.Telefono);
  const cap = str(body.CAP);
  const azienda = Boolean(body.Azienda);

  // Obbligatori come nel crea_cliente FlutterFlow: Nome, Email, Telefono, CAP.
  // Per un'azienda accettiamo la Ragione Sociale al posto del Nome persona.
  const hasNome = azienda ? Boolean(ragioneSociale || nome) : Boolean(nome);
  if (!hasNome || !email || !telefono || !cap) {
    return NextResponse.json(
      { error: "Compila i campi obbligatori: Nome, Email, Telefono, CAP" },
      { status: 400 }
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Email non valida" }, { status: 400 });
  }

  try {
    // Anti-duplicato per email (equivalente al flag `clienteEsiste` di FlutterFlow).
    const dup = await adminDb()
      .collection("Clienti")
      .where("Email", "==", email)
      .limit(1)
      .get();
    if (!dup.empty) {
      return NextResponse.json(
        { error: "Esiste già un cliente con questa email" },
        { status: 409 }
      );
    }

    const fidoRaw = Number(body.Fido);
    const fido = Number.isFinite(fidoRaw) ? fidoRaw : 0;

    // Sede dell'operatore che crea (come `currentUserDocument?.sede` in FlutterFlow).
    let sede: DocumentReference | undefined;
    try {
      const creator = await adminDb().collection("users").doc(session.uid).get();
      const s = creator.data()?.Sede;
      if (s && typeof s === "object" && "path" in s) sede = s as DocumentReference;
    } catch {
      /* Sede è opzionale: non blocca la creazione */
    }

    // Booleani, Fido e default sono sempre presenti; le stringhe solo se non vuote
    // (equivalente a `.withoutNulls` del generatore FlutterFlow).
    const data: Record<string, unknown> = {
      Azienda: azienda,
      B2B: false,
      Locale: true,
      ID: "",
      Fido: fido,
      Fido_Residuo: fido,
    };
    const optionalStrings: Record<string, string> = {
      Nome: nome,
      Ragione_Sociale: ragioneSociale,
      Email: email,
      Telefono: telefono,
      Via: str(body.Via),
      Citta: str(body.Citta),
      CAP: cap,
      Paese: str(body.Paese),
      Codice_Fiscale: str(body.Codice_Fiscale),
      Partita_Iva: str(body.Partita_Iva),
      PEC: str(body.PEC),
      Tipo: str(body.Tipo),
      Metodo_di_Pagamento: str(body.Metodo_di_Pagamento),
    };
    for (const [k, v] of Object.entries(optionalStrings)) if (v) data[k] = v;
    if (sede) data.Sede = sede;

    const ref = await adminDb().collection("Clienti").add(data);
    return NextResponse.json({ ok: true, id: ref.id });
  } catch (err) {
    console.error("[api/admin/clienti]", err);
    return NextResponse.json(
      { error: "Errore nella creazione del cliente" },
      { status: 500 }
    );
  }
}
