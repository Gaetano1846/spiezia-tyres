import { NextResponse, type NextRequest } from "next/server";
import https from "https";
import type { Ruolo } from "@/lib/types";
import { buildDevCookie, buildSessionCookie, buildRoleCookie } from "@/lib/auth";

// Node.js https rispetta NODE_TLS_REJECT_UNAUTHORIZED; native fetch (undici) no.
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
  // email/password servono SOLO allo shadow-verify della migrazione Firebase→PG
  // (vedi lib/spiezia-auth/shadow.ts): Firebase resta autoritativo, la password
  // non viene mai loggata né persistita.
  const { idToken, email: bodyEmail, password: bodyPassword } = await req.json();
  if (!idToken) return NextResponse.json({ error: "idToken required" }, { status: 400 });

  // ── Dev mode: Admin SDK assente → verifica idToken tramite Firestore REST ────
  // Il token viene decodificato per estrarre uid, ma la validità è confermata
  // dalla risposta Firestore (che usa il token come Bearer — fallisce se scaduto/falso).
  if (!isAdminConfigured()) {
    try {
      const parts = idToken.split(".");
      if (parts.length !== 3) {
        return NextResponse.json({ error: "Token malformato" }, { status: 401 });
      }
      const decoded = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
      const uid: string = decoded.user_id ?? decoded.sub ?? "";
      const email: string = decoded.email ?? "";

      if (!uid) {
        return NextResponse.json({ error: "uid non trovato nel token" }, { status: 401 });
      }

      // Verifica implicita: Firestore rifiuterà la richiesta se il Bearer token
      // è scaduto, revocato o falsificato (con regole non-`if true`).
      // Se la fetch fallisce → 401 senza eccezioni silenziate.
      const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
      const fsUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;

      let fsData: { fields?: Record<string, { stringValue?: string; booleanValue?: boolean }> };
      try {
        fsData = await httpsGet(fsUrl, idToken) as typeof fsData;
      } catch {
        // Token non valido o utente inesistente — non autenticare
        return NextResponse.json({ error: "Token non verificabile (dev)" }, { status: 401 });
      }

      const fields = fsData.fields ?? {};
      const Ruolo = (fields.Ruolo?.stringValue as Ruolo) ?? "Privato";
      const CRM = fields.CRM?.booleanValue ?? false;

      const sessionPayload = { uid, email, Ruolo, CRM };
      const res = NextResponse.json({ ok: true, Ruolo, CRM });
      res.headers.append("Set-Cookie", buildDevCookie(sessionPayload));
      res.headers.append("Set-Cookie", buildRoleCookie(Ruolo, CRM));
      return res;
    } catch (err) {
      console.error("[auth/login dev]", err);
      return NextResponse.json({ error: "Autenticazione fallita (dev)" }, { status: 401 });
    }
  }

  // ── Production: verifica idToken con Admin SDK ────────────────────────────
  try {
    const { adminAuth, adminDb } = await import("@/lib/firebase-admin");
    const decoded = await adminAuth().verifyIdToken(idToken);
    const userDoc = await adminDb().collection("users").doc(decoded.uid).get();
    if (!userDoc.exists) return NextResponse.json({ error: "Utente non trovato" }, { status: 403 });

    const data = userDoc.data()!;
    const Ruolo = (data.Ruolo as Ruolo) ?? "Privato";
    const CRM = Boolean(data.CRM);

    const sessionCookie = await adminAuth().createSessionCookie(idToken, { expiresIn: TTL_MS });
    const sessionPayload = { uid: decoded.uid, email: decoded.email ?? "", Ruolo, CRM };

    // Shadow-verify migrazione: valida il path Postgres in parallelo, mai bloccante.
    void import("@/lib/spiezia-auth/shadow")
      .then(({ runShadowAuthCheck }) =>
        runShadowAuthCheck({
          uid: decoded.uid,
          email: decoded.email ?? bodyEmail ?? "",
          password: typeof bodyPassword === "string" ? bodyPassword : undefined,
          ruolo: (data.Ruolo as string) ?? "Privato",
          crm: CRM,
        })
      )
      .catch((err) => console.error("[shadow-auth] avvio fallito:", err));

    const res = NextResponse.json({ ok: true, Ruolo, CRM });
    res.headers.append("Set-Cookie", buildSessionCookie(sessionCookie));
    res.headers.append("Set-Cookie", buildRoleCookie(Ruolo, CRM));
    // In development, getSession() reads spiezia_dev_session (plain JSON, no Admin SDK call).
    // Set it alongside the production session cookie so both dev and prod paths work locally.
    if (process.env.NODE_ENV === "development") {
      res.headers.append("Set-Cookie", buildDevCookie(sessionPayload));
    }
    return res;
  } catch (err) {
    console.error("[auth/login]", err);
    return NextResponse.json({ error: "Autenticazione fallita" }, { status: 401 });
  }
}
