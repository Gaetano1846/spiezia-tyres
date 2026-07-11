import { NextResponse } from "next/server";
import { getSession, isCRM } from "@/lib/auth";
import { createCliente, sedeIdForUser } from "@/lib/clientiDb";

// ─── Crea anagrafica Cliente ───────────────────────────────────────────────────
// Replica del `crea_cliente` FlutterFlow: crea SOLO un cliente (nessun account
// di login). Migrazione Fase 3: scrive su Postgres (core.clienti) invece che
// direttamente su Firestore — il bridge propaga la scrittura a Firestore in
// pochi secondi, così il CRM FlutterFlow legacy continua a vederla.
//
// Default fedeli a FlutterFlow: B2B=false, Locale=true, Sede = sede
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

  // Password opzionale: se fornita, crea l'identità di login del cliente. Min 6.
  const password = str(body.Password);
  if (password && password.length < 6) {
    return NextResponse.json({ error: "La password deve avere almeno 6 caratteri" }, { status: 400 });
  }

  try {
    const fidoRaw = Number(body.Fido);
    const fido = Number.isFinite(fidoRaw) ? fidoRaw : 0;

    // Sede dell'operatore che crea (come `currentUserDocument?.sede` in FlutterFlow).
    const sedeId = await sedeIdForUser(session.uid).catch(() => null);

    const cliente = await createCliente({
      Nome: nome || undefined,
      Ragione_Sociale: ragioneSociale || undefined,
      Email: email,
      Telefono: telefono,
      Via: str(body.Via) || undefined,
      Citta: str(body.Citta) || undefined,
      CAP: cap,
      Paese: str(body.Paese) || undefined,
      Codice_Fiscale: str(body.Codice_Fiscale) || undefined,
      Partita_Iva: str(body.Partita_Iva) || undefined,
      PEC: str(body.PEC) || undefined,
      Tipo: str(body.Tipo) || undefined,
      Metodo_di_Pagamento: str(body.Metodo_di_Pagamento) || undefined,
      Azienda: azienda,
      Fido: fido,
      SedeId: sedeId,
      Password: password || undefined,
    });

    if (!cliente) {
      // Anti-duplicato per email (equivalente al flag `clienteEsiste` di FlutterFlow).
      return NextResponse.json(
        { error: "Esiste già un cliente con questa email" },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true, id: cliente.id });
  } catch (err) {
    console.error("[api/admin/clienti]", err);
    return NextResponse.json(
      { error: "Errore nella creazione del cliente" },
      { status: 500 }
    );
  }
}
