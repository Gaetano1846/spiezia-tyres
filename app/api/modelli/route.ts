import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { listModelli, createModello } from "@/lib/modelliDb";
import { saveImageToPublic } from "@/lib/storage";

export const runtime = "nodejs";

// GET /api/modelli?search=&limit=&offset= — lista disegni/pattern.
// Sostituisce useFirestoreInfiniteList(collectionPath:"Modello").
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 100, 500);
  const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);

  try {
    const modelli = await listModelli({ search, limit, offset });
    return NextResponse.json({ modelli, hasMore: modelli.length === limit });
  } catch (err) {
    console.error("[api/modelli GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento disegni" }, { status: 500 });
  }
}

// POST — multipart/form-data: nome (required), file (opzionale). Sostituisce
// addDoc(collection(db,"Modello"),...) + uploadBytes/getDownloadURL.
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
  if (!nome) return NextResponse.json({ error: "Nome disegno mancante" }, { status: 400 });

  const file = form.get("file");
  try {
    const immagine = file instanceof File && file.size > 0 ? await saveImageToPublic(file, "disegni") : null;
    const modello = await createModello({ nome, immagine });
    return NextResponse.json({ modello }, { status: 201 });
  } catch (err) {
    console.error("[api/modelli POST]", err);
    return NextResponse.json({ error: "Errore nella creazione del disegno" }, { status: 500 });
  }
}
