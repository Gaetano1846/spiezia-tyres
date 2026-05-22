import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "spiezia_session";
const DEV_COOKIE = "spiezia_dev_session";

const PUBLIC_PATHS = ["/login", "/recupera-password"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const hasSession =
    request.cookies.has(SESSION_COOKIE) || request.cookies.has(DEV_COOKIE);

  if (!hasSession) {
    // In sviluppo locale auto-login come Admin (nessun Firebase richiesto)
    if (process.env.NODE_ENV === "development") {
      const devUrl = new URL("/api/auth/dev", request.url);
      devUrl.searchParams.set("role", "admin");
      devUrl.searchParams.set("to", pathname);
      return NextResponse.redirect(devUrl);
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|public/).*)",
  ],
};
