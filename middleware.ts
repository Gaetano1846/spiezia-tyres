import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/recupera-password"];

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

function getSessionCookie(req: NextRequest): string | undefined {
  if (process.env.NODE_ENV === "development") {
    return req.cookies.get("spiezia_dev_session")?.value;
  }
  return req.cookies.get("spiezia_session")?.value;
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

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  if (isPublic) {
    if (getSessionCookie(req)) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  const session = getSessionCookie(req);
  if (!session) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

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
    "/((?!api|_next/static|_next/image|favicon\\.ico|icons|images|fonts|.*\\..*).*)",
  ],
};
