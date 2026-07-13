import { NextResponse, type NextRequest } from "next/server";
import { verifyResetToken, setUserPassword } from "@/lib/spiezia-auth/passwordReset";

export const runtime = "nodejs";

// POST /api/auth/reset-password/confirm {token, password} — pagina web
// /reset-password (raggiunta dal link email) posta qui la nuova password.
export async function POST(req: NextRequest) {
  let body: { token?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const { token, password } = body;
  if (!token || !password) {
    return NextResponse.json({ error: "Token e password obbligatori" }, { status: 400 });
  }

  const verified = verifyResetToken(token);
  if (!verified) return NextResponse.json({ error: "Link scaduto o non valido" }, { status: 400 });

  try {
    await setUserPassword(verified.uid, password);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/auth/reset-password/confirm POST]", err);
    const message = err instanceof Error ? err.message : "Errore nel salvataggio";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
