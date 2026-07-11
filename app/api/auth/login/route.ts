import { NextResponse, type NextRequest } from "next/server";
import https from "https";
import type { Ruolo } from "@/lib/types";
import { buildDevCookie, buildSessionCookie, buildRoleCookie } from "@/lib/auth";
import { findUserByEmail, createPgSession } from "@/lib/spiezia-auth/session";
import { verifyUserPassword } from "@/lib/spiezia-auth/password";

export const runtime = "nodejs";

// Auth VPS-native (Fase 1 cutover). Ordine di verifica:
//   1. Postgres (core.auth_credentials): se l'utente ha una credenziale PG e la
//      password è corretta → sessione opaca su core.sessions, NESSUN Firebase.
//      È il path autoritativo del nuovo B2B.
//   2. Fallback Firebase (idToken): SOLO se il path PG non conclude (utente/
//      credenziale assente, o parametri scrypt mancanti). Rete di sicurezza
//      finché Firebase resta vivo per Flutter — ogni fallback è loggato così
//      accumuliamo evidenza reale di dove il PG non copre.
// La password non viene mai loggata né persistita in chiaro.

function httpsGet(url: string, token: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error("Invalid JSON")); }
      });
    }).on("error", reject);
  });
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isAdminConfigured(): boolean {
  return !!(process.env.FIREBASE_ADMIN_CLIENT_EMAIL && process.env.FIREBASE_ADMIN_PRIVATE_KEY);
}

export async function POST(req: NextRequest) {
  const { idToken, email: bodyEmail, password: bodyPassword } = await req.json();
  const email = typeof bodyEmail === "string" ? bodyEmail.trim() : "";
  const password = typeof bodyPassword === "string" ? bodyPassword : "";

  // ── 1. Path Postgres VPS-native ──────────────────────────────────────────
  if (process.env.DATABASE_URL && email && password) {
    try {
      const user = await findUserByEmail(email);
      if (user && !user.disabled) {
        const v = await verifyUserPassword(user.id, password);
        if (v.ok) {
          const token = await createPgSession(
            user.id,
            { Ruolo: user.Ruolo, CRM: user.CRM },
            { ip: req.headers.get("x-forwarded-for") ?? undefined, userAgent: req.headers.get("user-agent") ?? undefined },
          );
          if (token) {
            const res = NextResponse.json({ ok: true, Ruolo: user.Ruolo, CRM: user.CRM, backend: "pg" });
            res.headers.append("Set-Cookie", buildSessionCookie(token));
            res.headers.append("Set-Cookie", buildRoleCookie(user.Ruolo, user.CRM));
            return res;
          }
        } else if (v.reason === "bad_password" && idToken) {
          // PG ha una credenziale ma la password non combacia, mentre il client
          // ha ottenuto un idToken (Firebase l'ha accettata): mismatch reale da
          // investigare (parametri scrypt / password cambiata in un solo sistema).
          console.error(`[auth] MISMATCH PG/Firebase per ${email}: PG rifiuta, Firebase accetta`);
        }
        // no_credential / scrypt_params_missing → cade nel fallback Firebase sotto
      }
    } catch (err) {
      console.error("[auth] path PG fallito, fallback Firebase:", err instanceof Error ? err.message : err);
    }
  }

  // ── 2. Fallback Firebase (rete di sicurezza) ─────────────────────────────
  if (!idToken) return NextResponse.json({ error: "Credenziali non valide" }, { status: 401 });

  // Dev: Admin SDK assente → verifica idToken via Firestore REST
  if (!isAdminConfigured()) {
    try {
      const parts = idToken.split(".");
      if (parts.length !== 3) return NextResponse.json({ error: "Token malformato" }, { status: 401 });
      const decoded = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
      const uid: string = decoded.user_id ?? decoded.sub ?? "";
      const tokEmail: string = decoded.email ?? "";
      if (!uid) return NextResponse.json({ error: "uid non trovato nel token" }, { status: 401 });

      const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
      const fsUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;
      let fsData: { fields?: Record<string, { stringValue?: string; booleanValue?: boolean }> };
      try {
        fsData = await httpsGet(fsUrl, idToken) as typeof fsData;
      } catch {
        return NextResponse.json({ error: "Token non verificabile (dev)" }, { status: 401 });
      }
      const fields = fsData.fields ?? {};
      const Ruolo = (fields.Ruolo?.stringValue as Ruolo) ?? "Privato";
      const CRM = fields.CRM?.booleanValue ?? false;
      const res = NextResponse.json({ ok: true, Ruolo, CRM, backend: "firebase" });
      res.headers.append("Set-Cookie", buildDevCookie({ uid, email: tokEmail, Ruolo, CRM }));
      res.headers.append("Set-Cookie", buildRoleCookie(Ruolo, CRM));
      return res;
    } catch (err) {
      console.error("[auth/login dev]", err);
      return NextResponse.json({ error: "Autenticazione fallita (dev)" }, { status: 401 });
    }
  }

  // Prod: verifica idToken con Admin SDK
  try {
    const { adminAuth, adminDb } = await import("@/lib/firebase-admin");
    const decoded = await adminAuth().verifyIdToken(idToken);
    const userDoc = await adminDb().collection("users").doc(decoded.uid).get();
    if (!userDoc.exists) return NextResponse.json({ error: "Utente non trovato" }, { status: 403 });
    const data = userDoc.data()!;
    const Ruolo = (data.Ruolo as Ruolo) ?? "Privato";
    const CRM = Boolean(data.CRM);

    const sessionCookie = await adminAuth().createSessionCookie(idToken, { expiresIn: TTL_MS });
    console.warn(`[auth] login via FALLBACK Firebase per ${email || decoded.email} — credenziale PG non disponibile`);

    const res = NextResponse.json({ ok: true, Ruolo, CRM, backend: "firebase" });
    res.headers.append("Set-Cookie", buildSessionCookie(sessionCookie));
    res.headers.append("Set-Cookie", buildRoleCookie(Ruolo, CRM));
    return res;
  } catch (err) {
    console.error("[auth/login]", err);
    return NextResponse.json({ error: "Autenticazione fallita" }, { status: 401 });
  }
}
