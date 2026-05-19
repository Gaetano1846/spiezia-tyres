import { NextResponse, type NextRequest } from "next/server";

// Middleware runs on Edge Runtime — Firebase Admin SDK is NOT available here.
// Strategy: check cookie EXISTENCE as a fast redirect to /login.
// Actual session verification + role gating happens in each route-group layout
// using the Admin SDK (Node.js server components).

const SESSION_COOKIE = "spiezia_session";

const PUBLIC_PATHS = ["/login", "/recupera-password"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
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
