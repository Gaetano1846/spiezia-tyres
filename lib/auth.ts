import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebase-admin";
import { adminDb } from "@/lib/firebase-admin";
import type { SessionPayload, Ruolo } from "@/lib/types";

const SESSION_COOKIE = "spiezia_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni

export async function createSessionCookie(idToken: string): Promise<string> {
  const sessionCookie = await adminAuth().createSessionCookie(idToken, {
    expiresIn: SESSION_TTL_MS,
  });
  return sessionCookie;
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value;
  if (!session) return null;

  try {
    const decoded = await adminAuth().verifySessionCookie(session, true);
    const userDoc = await adminDb()
      .collection("users")
      .doc(decoded.uid)
      .get();

    if (!userDoc.exists) return null;
    const data = userDoc.data()!;

    return {
      uid: decoded.uid,
      email: decoded.email ?? "",
      Ruolo: (data.Ruolo as Ruolo) ?? "Privato",
      CRM: Boolean(data.CRM),
    };
  } catch {
    return null;
  }
}

export function setSessionCookie(cookie: string, response: Response): Response {
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`
  );
  return response;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function isAdmin(session: SessionPayload | null): boolean {
  return session?.Ruolo === "Admin";
}

export function isCRM(session: SessionPayload | null): boolean {
  return Boolean(session?.CRM);
}

export function isMagazzino(session: SessionPayload | null): boolean {
  return session?.Ruolo === "Admin" || session?.Ruolo === "Magazziniere";
}
