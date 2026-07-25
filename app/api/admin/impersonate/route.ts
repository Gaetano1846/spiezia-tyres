import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  getSession,
  isAdmin,
  SESSION_COOKIE,
  IMPERSONATOR_COOKIE,
  buildSessionCookie,
  buildRoleCookie,
  buildImpersonatorCookie,
} from "@/lib/auth";
import { createPgSession } from "@/lib/spiezia-auth/session";
import { getUtenteProfile } from "@/lib/utentiDb";

export const runtime = "nodejs";

// Ruoli staff: l'impersonazione copre solo "cliente" (Gommista/Grossista/
// Privato/T24) e Rappresentante, come richiesto — non altri account admin/staff.
const BLOCKED_ROLES = new Set(["admin", "magazziniere", "impiegato"]);

// POST /api/admin/impersonate {targetUserId} — admin "Accedi come" un
// cliente/rappresentante (admin/clienti). Crea una nuova sessione Postgres
// per il target (stesso pattern di app/api/auth/login/route.ts) e la mette
// su spiezia_session, preservando il token admin corrente su un secondo
// cookie httpOnly (spiezia_impersonator) per poter tornare admin senza un
// secondo login — vedi /api/admin/impersonate/return.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const store = await cookies();
  // Niente impersonazione annidata: sovrascriverebbe il token admin originale
  // già preservato, perdendo per sempre il modo di tornare admin in questo browser.
  if (store.get(IMPERSONATOR_COOKIE)?.value) {
    return NextResponse.json(
      { error: "Stai già impersonando un utente — torna admin prima di accedere come qualcun altro" },
      { status: 409 }
    );
  }

  const adminToken = store.get(SESSION_COOKIE)?.value;
  if (!adminToken) {
    return NextResponse.json({ error: "Sessione admin non valida" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const targetUserId = typeof body?.targetUserId === "string" ? body.targetUserId : "";
  if (!targetUserId) {
    return NextResponse.json({ error: "targetUserId obbligatorio" }, { status: 400 });
  }

  const target = await getUtenteProfile(targetUserId);
  if (!target) {
    return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });
  }

  const targetRuolo = target.Ruolo ?? "Privato";
  if (BLOCKED_ROLES.has(targetRuolo.toLowerCase())) {
    return NextResponse.json(
      { error: `Non è possibile impersonare un account di ruolo ${targetRuolo}` },
      { status: 403 }
    );
  }

  const token = await createPgSession(
    targetUserId,
    { Ruolo: targetRuolo, CRM: target.CRM },
    { ip: req.headers.get("x-forwarded-for") ?? undefined, userAgent: req.headers.get("user-agent") ?? undefined }
  );
  if (!token) {
    return NextResponse.json({ error: "Impersonazione non disponibile" }, { status: 500 });
  }

  console.log(
    `[impersonate] admin=${session.email} (${session.uid}) → target=${target.email} (${targetUserId}, ${targetRuolo}) at ${new Date().toISOString()}`
  );

  const res = NextResponse.json({ ok: true, Ruolo: targetRuolo, CRM: target.CRM });
  res.headers.append("Set-Cookie", buildSessionCookie(token));
  res.headers.append("Set-Cookie", buildImpersonatorCookie(adminToken));
  res.headers.append("Set-Cookie", buildRoleCookie(targetRuolo, target.CRM));
  return res;
}
