import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/recupera-password"];

function getSessionCookie(req: NextRequest): string | undefined {
  return (
    req.cookies.get("spiezia_session")?.value ||
    req.cookies.get("spiezia_dev_session")?.value
  );
}

function getRoleData(req: NextRequest): { Ruolo: string; CRM: boolean } | null {
  const raw = req.cookies.get("user-role")?.value;
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw)) as { Ruolo: string; CRM: boolean };
  } catch {
    return null;
  }
}

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  if (isPublic) {
    // Se ha ENTRAMBI i cookie (sessione + ruolo), rimanda alla home corretta.
    // Se manca uno dei due (es. sessione stantia senza ruolo), lascia andare
    // al login così il layout pulisce lo stato.
    const session = getSessionCookie(req);
    const role = getRoleData(req);
    if (session && role) {
      const ruolo = role.Ruolo?.toLowerCase() ?? "";
      const dest =
        ruolo === "admin"       ? "/admin/ordini" :
        ruolo === "magazziniere"? "/magazzino" :
        role.CRM                ? "/dashboard" : "/";
      return NextResponse.redirect(new URL(dest, req.url));
    }
    return NextResponse.next();
  }

  // Per le rotte protette: il gating granulare (ruolo specifico) lo fanno i layout
  // server-side che leggono e verificano il session cookie in modo sicuro.
  // Il middleware si limita a far passare tutto — evita falsi positivi da race condition
  // sul cookie user-role (che può arrivare qualche millisecondo dopo la sessione).
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon\\.ico|.*\\..*).*)",
  ],
};
