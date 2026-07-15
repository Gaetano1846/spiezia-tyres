import { NextResponse, type NextRequest } from "next/server";
import { buildSessionCookie, buildRoleCookie } from "@/lib/auth";
import { findUserByEmail, createPgSession } from "@/lib/spiezia-auth/session";
import { verifyUserPassword } from "@/lib/spiezia-auth/password";

export const runtime = "nodejs";

// Auth VPS-native — UNICO backend (core.auth_credentials / core.sessions).
// Il fallback Firebase (idToken/session-cookie) è stato rimosso: l'intera base
// storica ha una credenziale Postgres (hash scrypt importati da Firebase Auth
// via GCIP v2 — Fase 1, backfillati anche per gli ultimi orfani residui) e le
// password nuove sono create direttamente su core.auth_credentials
// (argon2id). Nessun idToken/verifica Firebase da qui in poi.
// La password non viene mai loggata né persistita in chiaro.

export async function POST(req: NextRequest) {
  const { email: bodyEmail, password: bodyPassword } = await req.json();
  const email = typeof bodyEmail === "string" ? bodyEmail.trim() : "";
  const password = typeof bodyPassword === "string" ? bodyPassword : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Credenziali non valide" }, { status: 401 });
  }

  try {
    const user = await findUserByEmail(email);
    if (!user || user.disabled) {
      return NextResponse.json({ error: "Email o password errati" }, { status: 401 });
    }

    const v = await verifyUserPassword(user.id, password);
    if (!v.ok) {
      return NextResponse.json({ error: "Email o password errati" }, { status: 401 });
    }

    const token = await createPgSession(
      user.id,
      { Ruolo: user.Ruolo, CRM: user.CRM },
      { ip: req.headers.get("x-forwarded-for") ?? undefined, userAgent: req.headers.get("user-agent") ?? undefined },
    );
    if (!token) {
      return NextResponse.json({ error: "Autenticazione non disponibile" }, { status: 500 });
    }

    // token nel body: consumato dai client nativi (app Flutter) che non
    // possono gestire un cookie jar e mandano Authorization: Bearer <token>
    // su ogni richiesta successiva (vedi lib/auth.ts::getSession). Il
    // browser continua a usare il Set-Cookie, ignora questo campo extra.
    const res = NextResponse.json({ ok: true, Ruolo: user.Ruolo, CRM: user.CRM, backend: "pg", token });
    res.headers.append("Set-Cookie", buildSessionCookie(token));
    res.headers.append("Set-Cookie", buildRoleCookie(user.Ruolo, user.CRM));
    return res;
  } catch (err) {
    console.error("[auth/login]", err);
    return NextResponse.json({ error: "Autenticazione fallita" }, { status: 401 });
  }
}
