import { NextResponse, type NextRequest } from "next/server";
import type { Ruolo } from "@/lib/types";
import { buildDevCookie, buildSessionCookie } from "@/lib/auth";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isAdminConfigured(): boolean {
  return !!(process.env.FIREBASE_ADMIN_CLIENT_EMAIL && process.env.FIREBASE_ADMIN_PRIVATE_KEY);
}

export async function POST(req: NextRequest) {
  const { idToken } = await req.json();
  if (!idToken) return NextResponse.json({ error: "idToken required" }, { status: 400 });

  // ── Dev mode: Admin SDK assente → decodifica JWT senza verifica crittografica ─
  if (!isAdminConfigured()) {
    try {
      const [, payload] = idToken.split(".");
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
      const uid: string = decoded.user_id ?? decoded.sub ?? "";
      const email: string = decoded.email ?? "";

      // Legge Ruolo + CRM da Firestore tramite REST (nessun Admin SDK)
      const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
      const fsUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;
      const fsRes = await fetch(fsUrl, {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      let Ruolo: Ruolo = "Privato";
      let CRM = false;

      if (fsRes.ok) {
        const fsData = await fsRes.json();
        const fields = fsData.fields ?? {};
        Ruolo = (fields.Ruolo?.stringValue as Ruolo) ?? "Privato";
        CRM = fields.CRM?.booleanValue ?? false;
      }

      const sessionPayload = { uid, email, Ruolo, CRM };
      const res = NextResponse.json({ ok: true, Ruolo, CRM });
      res.headers.append("Set-Cookie", buildDevCookie(sessionPayload));
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
    const res = NextResponse.json({ ok: true, Ruolo, CRM });
    res.headers.append("Set-Cookie", buildSessionCookie(sessionCookie));
    return res;
  } catch (err) {
    console.error("[auth/login]", err);
    return NextResponse.json({ error: "Autenticazione fallita" }, { status: 401 });
  }
}
