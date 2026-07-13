import { NextResponse, type NextRequest } from "next/server";
import { findUserByEmail } from "@/lib/spiezia-auth/session";
import { createResetToken } from "@/lib/spiezia-auth/passwordReset";
import { sendEmailReply } from "@/lib/emailAdmin/sendReply.js";

export const runtime = "nodejs";

// POST /api/auth/reset-password {email} — richiesta reset password per
// client nativi (app Flutter magazzino) che non hanno un SDK Firebase Auth
// per sendPasswordResetEmail. Risponde sempre {ok:true}, anche se l'email
// non esiste, per non rivelare quali indirizzi sono registrati.
export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const email = body.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "Email obbligatoria" }, { status: 400 });

  try {
    const user = await findUserByEmail(email);
    if (user && !user.disabled) {
      const token = createResetToken(user.id);
      const base = process.env.NEXT_PUBLIC_APP_URL || "https://b2b2.spieziatyres.it";
      const link = `${base}/reset-password?token=${token}`;
      await sendEmailReply({
        to: email,
        subject: "Recupera password — Spiezia Tyres",
        html:
          `<p>Richiesta di reimpostazione password per l'app di magazzino Spiezia Tyres.</p>` +
          `<p><a href="${link}">Imposta una nuova password</a></p>` +
          `<p>Il link scade tra 30 minuti. Se non hai richiesto tu il reset, ignora questa email.</p>`,
      });
    }
  } catch (err) {
    console.error("[api/auth/reset-password POST]", err);
    // Non esporre l'errore: risposta comunque ok, per non rivelare stato interno.
  }

  return NextResponse.json({ ok: true });
}
