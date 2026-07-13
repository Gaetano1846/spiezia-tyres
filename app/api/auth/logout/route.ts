import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { clearCookies } from "@/lib/auth";
import { revokePgSession } from "@/lib/spiezia-auth/session";

export const runtime = "nodejs";

// Revoca la sessione PG prima di cancellare i cookie, così il token non
// resta valido lato server. Client nativi (app Flutter) non hanno un cookie
// jar: mandano il token via Authorization: Bearer, stesso ordine di verifica
// di getSession() (lib/auth.ts).
async function revokeCurrent() {
  const authHeader = (await headers()).get("authorization") ?? "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    await revokePgSession(authHeader.slice(7).trim());
    return;
  }
  const store = await cookies();
  await revokePgSession(store.get("spiezia_session")?.value);
}

export async function POST() {
  await revokeCurrent();
  const res = NextResponse.json({ ok: true });
  for (const c of clearCookies()) res.headers.append("Set-Cookie", c);
  return res;
}

export async function GET() {
  await revokeCurrent();
  const res = NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3301"));
  for (const c of clearCookies()) res.headers.append("Set-Cookie", c);
  return res;
}
