import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM, isAdmin } from "@/lib/auth";
import { listOperatori, createOperatore } from "@/lib/operatoriDb";

export const runtime = "nodejs";

// GET/POST /api/operatori — operatori CRM (core.utenti, crm=true/Admin).
// Sostituisce le query dirette Firestore `collection(db,"users").where("CRM","==",true)`
// usate nei picker "Operatore" (appuntamenti/nuova, appuntamenti/[id]/modifica,
// fogli-di-lavoro) e nella pagina admin/operatori. Il bridge esistente propaga
// le scritture a Firestore per il CRM FlutterFlow legacy.
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  try {
    const operatori = await listOperatori();
    return NextResponse.json({ operatori });
  } catch (err) {
    console.error("[api/operatori GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento operatori" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!displayName || !email) {
    return NextResponse.json({ error: "Nome ed email sono obbligatori" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password minimo 6 caratteri" }, { status: 400 });
  }

  try {
    const operatore = await createOperatore({
      displayName,
      email,
      password,
      ruolo: (body.ruolo as string) || "Impiegato",
      sedeId: (body.sedeId as string) || null,
      mansioneId: (body.mansioneId as string) || null,
      repartoId: (body.repartoId as string) || null,
    });
    if (!operatore) return NextResponse.json({ error: "Email già in uso" }, { status: 409 });
    return NextResponse.json({ operatore }, { status: 201 });
  } catch (err) {
    console.error("[api/operatori POST]", err);
    return NextResponse.json({ error: "Errore nella creazione dell'operatore" }, { status: 500 });
  }
}
