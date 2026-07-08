import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { setBannerCopertina } from "@/lib/bannerDb";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  let body: { value?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  try {
    await setBannerCopertina(id, body.value ?? false);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/banner/:id/copertina POST]", err);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}
