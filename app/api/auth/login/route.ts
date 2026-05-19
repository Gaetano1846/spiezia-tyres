import { NextResponse, type NextRequest } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import type { Ruolo } from "@/lib/types";

const SESSION_COOKIE = "spiezia_session";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const { idToken } = await req.json();

  if (!idToken) {
    return NextResponse.json({ error: "idToken required" }, { status: 400 });
  }

  try {
    const decoded = await adminAuth().verifyIdToken(idToken);

    const userDoc = await adminDb().collection("users").doc(decoded.uid).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: "Utente non trovato" }, { status: 403 });
    }

    const data = userDoc.data()!;
    const Ruolo = (data.Ruolo as Ruolo) ?? "Privato";
    const CRM = Boolean(data.CRM);

    // Stamp Ruolo + CRM as custom claims so middleware can read them without a DB call
    await adminAuth().setCustomUserClaims(decoded.uid, { Ruolo, CRM });

    // Re-mint ID token with new claims then create session cookie
    // (claims take effect on next token refresh; use the existing token for session creation)
    const sessionCookie = await adminAuth().createSessionCookie(idToken, { expiresIn: TTL_MS });

    const res = NextResponse.json({ ok: true, Ruolo, CRM });
    res.cookies.set(SESSION_COOKIE, sessionCookie, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: TTL_MS / 1000,
      path: "/",
    });
    return res;
  } catch (err) {
    console.error("[auth/login]", err);
    return NextResponse.json({ error: "Autenticazione fallita" }, { status: 401 });
  }
}
