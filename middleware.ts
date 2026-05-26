import { NextResponse, type NextRequest } from "next/server";

// Public paths: accessible without authentication
const PUBLIC_PATHS = ["/login", "/recupera-password"];

// Paths that require CRM or Admin role
const CRM_PATHS = [
  "/dashboard",
  "/clienti",
  "/preventivi",
  "/appuntamenti",
  "/fogli-di-lavoro",
  "/notifiche",
];
const ADMIN_PATHS = ["/admin"];
const MAGAZZINO_PATHS = ["/magazzino"];

// Check either session cookie (prod or dev). Auth verification (signature check) happens
// server-side in getSession(). Here we only need presence for routing decisions.
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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Public paths ────────────────────────────────────────────────────────────
  // Already authenticated → redirect away from login. Not authenticated → pass through.
  // Unauthenticated access to protected routes is handled by server-side layouts
  // (getSession() + redirect("/login")) — this avoids RSC navigation 404 issues
  // that occur when middleware redirects mid-client-navigation in Next.js 16.
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  if (isPublic) {
    if (getSessionCookie(req)) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  // ── Role-based routing (only for authenticated sessions) ────────────────────
  const session = getSessionCookie(req);
  if (!session) return NextResponse.next(); // layout will redirect to /login

  const role = getRoleData(req);
  const ruolo = role?.Ruolo?.toLowerCase() ?? "";

  if (CRM_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (!role?.CRM && ruolo !== "admin") {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  if (ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (ruolo !== "admin") {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  if (MAGAZZINO_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (ruolo !== "admin" && ruolo !== "magazziniere") {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files. Page routes always have no dot in the path.
    "/((?!api|_next/static|_next/image|favicon\\.ico|.*\\..*).*)",
  ],
};
