import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ ok: true });
}

export const runtime = "nodejs";
