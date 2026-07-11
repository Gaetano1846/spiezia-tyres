import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearCookies } from "@/lib/auth";
import { revokePgSession } from "@/lib/spiezia-auth/session";

export const runtime = "nodejs";

// Revoca la sessione PG (se il cookie è un token sp1_) prima di cancellare i
// cookie, così il token non resta valido lato server.
async function revokeCurrent() {
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
