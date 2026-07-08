import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { toggleBannerAttivo, deleteBanner } from "@/lib/bannerDb";

export const runtime = "nodejs";

export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const banner = await toggleBannerAttivo(id);
    if (!banner) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
    return NextResponse.json({ banner });
  } catch (err) {
    console.error("[api/banner/:id PATCH]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  try {
    await deleteBanner(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/banner/:id DELETE]", err);
    return NextResponse.json({ error: "Errore nell'eliminazione" }, { status: 500 });
  }
}
