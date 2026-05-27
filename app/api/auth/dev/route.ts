import { NextResponse, type NextRequest } from "next/server";
import { buildDevCookie, buildRoleCookie } from "@/lib/auth";
import type { SessionPayload, Ruolo } from "@/lib/types";

// Disponibile SOLO quando l'Admin SDK non è configurato (sviluppo locale).
// In produzione (Vercel con Admin SDK) risponde 404.

const ADMIN_CONFIGURED = !!(
  process.env.FIREBASE_ADMIN_CLIENT_EMAIL && process.env.FIREBASE_ADMIN_PRIVATE_KEY
);

const PRESET: Record<string, SessionPayload> = {
  admin:          { uid: "dev-admin",   email: "admin@spieziatyres.it",          Ruolo: "Admin",          CRM: true  },
  crm:            { uid: "dev-crm",     email: "crm@spieziatyres.it",            Ruolo: "Impiegato",      CRM: true  },
  gommista:       { uid: "dev-gom",     email: "gommista@spieziatyres.it",       Ruolo: "Gommista",       CRM: false },
  grossista:      { uid: "dev-gros",    email: "grossista@spieziatyres.it",      Ruolo: "Grossista",      CRM: false },
  privato:        { uid: "dev-priv",    email: "privato@spieziatyres.it",        Ruolo: "Privato",        CRM: false },
  t24:            { uid: "dev-t24",     email: "t24@spieziatyres.it",            Ruolo: "T24",            CRM: false },
  rappresentante: { uid: "dev-repr",    email: "rappresentante@spieziatyres.it", Ruolo: "Rappresentante", CRM: false },
  magazzino:      { uid: "dev-mag",     email: "magazzino@spieziatyres.it",      Ruolo: "Magazziniere",   CRM: false },
  b2b:            { uid: "dev-b2b",     email: "cliente@spieziatyres.it",        Ruolo: "Gommista",       CRM: false },
};

export function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") return NextResponse.json({ error: "Not available in production" }, { status: 404 });

  const role = request.nextUrl.searchParams.get("role") ?? "admin";
  const payload = PRESET[role] ?? PRESET.admin;

  const redirectTo = request.nextUrl.searchParams.get("to") ?? (
    payload.CRM           ? "/dashboard" :
    payload.Ruolo === "Admin"        ? "/admin/ordini" :
    payload.Ruolo === "Magazziniere" ? "/magazzino" :
    "/"
  );

  const res = NextResponse.redirect(new URL(redirectTo, request.url));
  res.headers.append("Set-Cookie", buildDevCookie(payload));
  res.headers.append("Set-Cookie", buildRoleCookie(payload.Ruolo, payload.CRM));
  return res;
}
