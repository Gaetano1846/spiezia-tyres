import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getSession,
  SESSION_COOKIE,
  buildSessionCookie,
  buildRoleCookie,
  clearImpersonatorCookie,
  getImpersonatorToken,
  clearCookies,
} from "@/lib/auth";
import { getPgSession, revokePgSession } from "@/lib/spiezia-auth/session";

export const runtime = "nodejs";

// POST /api/admin/impersonate/return — chiude un'impersonazione attiva
// ("Accedi come") e ripristina la sessione admin originale. Non richiede
// isAdmin: la sessione CORRENTE è quella impersonata (non admin) — la prova
// di identità admin è il possesso di un cookie spiezia_impersonator ancora
// valido, verificato qui sotto.
export async function POST() {
  const impersonated = await getSession(); // per il log, prima di revocare
  const impersonatorToken = await getImpersonatorToken();

  if (!impersonatorToken) {
    return NextResponse.json({ error: "Non stai impersonando nessun utente" }, { status: 400 });
  }

  const adminSession = await getPgSession(impersonatorToken);
  if (!adminSession) {
    // Il token admin preservato non è più valido (scaduto/revocato nel
    // frattempo) — nessun modo pulito di tornare admin, si pulisce tutto.
    const res = NextResponse.json({ error: "Sessione admin scaduta, effettua di nuovo il login" }, { status: 401 });
    for (const c of clearCookies()) res.headers.append("Set-Cookie", c);
    return res;
  }

  const store = await cookies();
  const impersonatedToken = store.get(SESSION_COOKIE)?.value;
  if (impersonatedToken) await revokePgSession(impersonatedToken);

  console.log(
    `[impersonate/return] admin=${adminSession.email} (${adminSession.uid}) ← target=${impersonated?.email ?? "?"} (${impersonated?.uid ?? "?"}) at ${new Date().toISOString()}`
  );

  const res = NextResponse.json({ ok: true, Ruolo: adminSession.Ruolo, CRM: adminSession.CRM });
  res.headers.append("Set-Cookie", buildSessionCookie(impersonatorToken));
  res.headers.append("Set-Cookie", clearImpersonatorCookie());
  res.headers.append("Set-Cookie", buildRoleCookie(adminSession.Ruolo, adminSession.CRM));
  return res;
}
