import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { listMarche, createMarca } from "@/lib/marcheDb";
import { saveImageToPublic } from "@/lib/storage";

export const runtime = "nodejs";

// GET /api/marche?search=&limit=&offset= — lista brand.
// Sostituisce useFirestoreInfiniteList(collectionPath:"Marca_Prodotto").
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 100, 500);
  const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);

  try {
    const marche = await listMarche({ search, limit, offset });
    return NextResponse.json({ marche, hasMore: marche.length === limit });
  } catch (err) {
    console.error("[api/marche GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento brand" }, { status: 500 });
  }
}

// POST — multipart/form-data: nome (required), file (opzionale, logo).
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
  const nome = (form.get("nome") as string | null)?.trim();
  if (!nome) return NextResponse.json({ error: "Nome brand mancante" }, { status: 400 });

  const file = form.get("file");
  try {
    const logo = file instanceof File && file.size > 0 ? await saveImageToPublic(file, "brand_logos") : null;
    const marca = await createMarca({ nome, logo });
    return NextResponse.json({ marca }, { status: 201 });
  } catch (err) {
    console.error("[api/marche POST]", err);
    return NextResponse.json({ error: "Errore nella creazione del brand" }, { status: 500 });
  }
}
