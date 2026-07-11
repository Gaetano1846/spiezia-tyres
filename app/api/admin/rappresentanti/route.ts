import { NextResponse } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { createRappresentante } from "@/lib/utentiDb";

// ─── Crea account Rappresentante ────────────────────────────────────────────
// A differenza di /api/admin/clienti (anagrafica cliente, login opzionale),
// qui si crea SOLO un'identità di login con ruolo Rappresentante — nessuna
// anagrafica Clienti collegata. Il bridge propaga il nuovo utente a Firestore
// (users/{id}) come per ogni altro account, quindi compare subito nel
// picker "Rappresentante" già esistente in admin/clienti.

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }

  const nome = str(body.Nome);
  const email = str(body.Email);
  const password = str(body.Password);

  if (!nome || !email) {
    return NextResponse.json({ error: "Nome ed email sono obbligatori" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Email non valida" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "La password deve avere almeno 6 caratteri" }, { status: 400 });
  }

  try {
    const rappresentante = await createRappresentante({ Nome: nome, Email: email, Password: password });
    if (!rappresentante) {
      return NextResponse.json({ error: "Esiste già un account con questa email" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, id: rappresentante.id });
  } catch (err) {
    console.error("[api/admin/rappresentanti]", err);
    return NextResponse.json({ error: "Errore nella creazione del rappresentante" }, { status: 500 });
  }
}
