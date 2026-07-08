import { cookies } from "next/headers";
import { timingSafeEqual, createHmac } from "node:crypto";
import type { SessionPayload, Ruolo } from "@/lib/types";

const SESSION_COOKIE = "spiezia_session";
const DEV_COOKIE = "spiezia_dev_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Firestore storico ha Ruolo con casing misto ("admin", "ADMIN", "Admin"…).
// Normalizziamo a Prima-maiuscola così i confronti (isAdmin ecc.) sono affidabili
// sia in dev che in prod, indipendentemente da come è scritto il valore nel DB.
function normalizeRuolo(raw: unknown): Ruolo {
  const s = String(raw ?? "Privato");
  return (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()) as Ruolo;
}

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
      const payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8")) as SessionPayload;
      // Stessa normalizzazione del ramo production: il cookie dev contiene il Ruolo
      // grezzo da Firestore, qui lo allineiamo così "admin" === Admin ovunque.
      return { ...payload, Ruolo: normalizeRuolo(payload.Ruolo) };
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
    return {
      uid: decoded.uid,
      email: decoded.email ?? "",
      Ruolo: normalizeRuolo(data.Ruolo),
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

// Non-httpOnly: letto dal middleware Edge per routing per ruolo (non è segreto — la sicurezza vera è nel session cookie)
export function buildRoleCookie(Ruolo: string, CRM: boolean): string {
  const value = encodeURIComponent(JSON.stringify({ Ruolo, CRM }));
  return `user-role=${value}; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

// Auth machine-to-machine per endpoint chiamati da cron/script interni (Fase 9
// — importer ordini), non da browser: nessun cookie di sessione disponibile.
// Header `x-internal-secret` confrontato a tempo costante contro
// IMPORT_ORDINI_SECRET. Fail-closed se il secret non è configurato.
export function verifyInternalSecret(req: Request): boolean {
  const expected = process.env.IMPORT_ORDINI_SECRET;
  if (!expected) return false;
  const provided = req.headers.get("x-internal-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Verifica la firma HMAC-SHA256 di un webhook WooCommerce (header X-WC-Webhook-Signature, base64 di hash_hmac('sha256', $payload, $secret, true)). Richiede il body raw (pre-JSON.parse). */
export function verifyWooWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WC_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function clearCookies(): string[] {
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    `${DEV_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `user-role=; Path=/; SameSite=Lax; Max-Age=0`,
  ];
}
