import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { listBanners, createBanner, saveBannerImage } from "@/lib/bannerDb";

export const runtime = "nodejs";

// GET /api/banner[?active=true] — sostituisce collection(db,"Promo_Immagini")
// in admin/banner (tutti) e PromoCarousel (solo attivi).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  const activeOnly = req.nextUrl.searchParams.get("active") === "true";
  try {
    const banners = await listBanners(activeOnly);
    return NextResponse.json({ banners });
  } catch (err) {
    console.error("[api/banner GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento" }, { status: 500 });
  }
}

// POST — upload multipart/form-data, salva su disco locale VPS (Fase 6:
// non più Firebase Storage). Sostituisce uploadBytes/getDownloadURL.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Seleziona un'immagine" }, { status: 400 });
  }
  try {
    const url = await saveBannerImage(file);
    const banner = await createBanner(url);
    return NextResponse.json({ banner }, { status: 201 });
  } catch (err) {
    console.error("[api/banner POST]", err);
    return NextResponse.json({ error: "Errore nel caricamento immagine" }, { status: 500 });
  }
}
