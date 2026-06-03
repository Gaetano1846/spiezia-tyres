import { NextResponse } from "next/server";
import { clearCookies } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  for (const c of clearCookies()) res.headers.append("Set-Cookie", c);
  return res;
}

export async function GET() {
  const res = NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3301"));
  for (const c of clearCookies()) res.headers.append("Set-Cookie", c);
  return res;
}
