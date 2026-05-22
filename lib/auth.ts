import { cookies } from "next/headers";
import type { SessionPayload, Ruolo } from "@/lib/types";

const SESSION_COOKIE = "spiezia_session";
const DEV_COOKIE = "spiezia_dev_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isAdminConfigured(): boolean {
  return !!(process.env.FIREBASE_ADMIN_CLIENT_EMAIL && process.env.FIREBASE_ADMIN_PRIVATE_KEY);
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();

  // ── Dev locale: leggi sempre il cookie dev, nessuna verifica Firebase ──────
  if (process.env.NODE_ENV === "development") {
    const raw = cookieStore.get(DEV_COOKIE)?.value;
    if (!raw) return null;
    try {
      return JSON.parse(Buffer.from(raw, "base64url").toString("utf-8")) as SessionPayload;
    } catch {
      return null;
    }
  }

  // ── Production: verifica session cookie Firebase Admin ────────────────────
  const session = cookieStore.get(SESSION_COOKIE)?.value;
  if (!session) return null;

  try {
    const { adminAuth, adminDb } = await import("@/lib/firebase-admin");
    const decoded = await adminAuth().verifySessionCookie(session, true);
    const userDoc = await adminDb().collection("users").doc(decoded.uid).get();
    if (!userDoc.exists) return null;
    const data = userDoc.data()!;
    // Normalizza il Ruolo: prima lettera maiuscola (Firestore storico ha valori misti)
    const rawRuolo = String(data.Ruolo ?? "Privato");
    const normRuolo = (rawRuolo.charAt(0).toUpperCase() + rawRuolo.slice(1).toLowerCase()) as Ruolo;
    return {
      uid: decoded.uid,
      email: decoded.email ?? "",
      Ruolo: normRuolo,
      CRM: Boolean(data.CRM),
    };
  } catch {
    return null;
  }
}

export function isAdmin(s: SessionPayload | null): boolean {
  return s?.Ruolo?.toLowerCase() === "admin";
}
export function isCRM(s: SessionPayload | null): boolean {
  return Boolean(s?.CRM) || isAdmin(s);
}
export function isMagazzino(s: SessionPayload | null): boolean {
  const r = s?.Ruolo?.toLowerCase() ?? "";
  return r === "admin" || r === "magazziniere";
}

export function buildDevCookie(payload: SessionPayload): string {
  const value = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${DEV_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function buildSessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearCookies(): string[] {
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    `${DEV_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  ];
}
