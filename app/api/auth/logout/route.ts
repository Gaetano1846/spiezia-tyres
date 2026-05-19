import { NextResponse } from "next/server";
import { clearCookies } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  for (const c of clearCookies()) res.headers.append("Set-Cookie", c);
  return res;
}
