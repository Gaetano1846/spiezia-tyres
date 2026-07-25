import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession, isAdmin } from "@/lib/auth";
import { getUtenteProfile } from "@/lib/utentiDb";
import { createResetToken, setUserPassword } from "@/lib/spiezia-auth/passwordReset";
import { sendEmailReply } from "@/lib/emailAdmin/sendReply.js";

export const runtime = "nodejs";

function generatePassword(length = 12): string {
  // Charset senza caratteri ambigui (0/O, 1/l/I) — la password va letta e
  // ridigitata da un cliente da un'email, non solo copiata-incollata.
  const charset = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += charset[bytes[i] % charset.length];
  return out;
}

// POST /api/utenti/[id]/password {mode:"link"} | {mode:"set", password?} —
// admin/clienti: manda un link di reset (riusa lib/spiezia-auth/passwordReset.ts,
// stesso meccanismo già in produzione per /api/auth/reset-password) oppure
// imposta direttamente una nuova password (generata se non fornita) e la
// invia in chiaro via email — unico modo per il cliente di riceverla, dato
// che dopo l'hash argon2id non è più recuperabile. L'email del destinatario
// si legge sempre dal server (mai dal body): non ci si fida di un indirizzo
// passato dal client per una credenziale sensibile.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { id } = await params;
  const target = await getUtenteProfile(id);
  if (!target || !target.email) {
    return NextResponse.json({ error: "Utente non trovato o senza email" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const mode = body?.mode;
  if (mode !== "link" && mode !== "set") {
    return NextResponse.json({ error: "mode deve essere 'link' o 'set'" }, { status: 400 });
  }

  try {
    if (mode === "link") {
      const token = createResetToken(id);
      const base = process.env.NEXT_PUBLIC_APP_URL || "https://b2b2.spieziatyres.it";
      const link = `${base}/reset-password?token=${token}`;
      await sendEmailReply({
        to: target.email,
        subject: "Reimposta la tua password — Spiezia Tyres",
        html:
          `<p>Un amministratore Spiezia Tyres ha richiesto la reimpostazione della tua password.</p>` +
          `<p><a href="${link}">Imposta una nuova password</a></p>` +
          `<p>Il link scade tra 30 minuti. Se non riconosci questa richiesta, contattaci.</p>`,
      });
      return NextResponse.json({ ok: true });
    }

    // mode === "set"
    const providedPassword = typeof body?.password === "string" ? body.password.trim() : "";
    if (providedPassword && providedPassword.length < 6) {
      return NextResponse.json({ error: "La password deve avere almeno 6 caratteri" }, { status: 400 });
    }
    const password = providedPassword || generatePassword();

    await setUserPassword(id, password);
    await sendEmailReply({
      to: target.email,
      subject: "La tua password è stata aggiornata — Spiezia Tyres",
      html:
        `<p>Un amministratore Spiezia Tyres ha impostato una nuova password per il tuo account.</p>` +
        `<p>Nuova password: <strong>${password}</strong></p>` +
        `<p>Ti consigliamo di cambiarla al primo accesso.</p>`,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/utenti/[id]/password]", err);
    return NextResponse.json({ error: "Errore nell'invio" }, { status: 500 });
  }
}
