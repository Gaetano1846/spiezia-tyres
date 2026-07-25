import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { getMarca, updateMarca, deleteMarca } from "@/lib/marcheDb";
import { saveImageToPublic } from "@/lib/storage";

export const runtime = "nodejs";

// PATCH — multipart/form-data: nome (required), file (opzionale, nuovo
// logo), removeImage ("true" per rimuovere il logo esistente).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const nome = (form.get("nome") as string | null)?.trim();
  if (!nome) return NextResponse.json({ error: "Nome brand mancante" }, { status: 400 });

  const file = form.get("file");
  const removeImage = form.get("removeImage") === "true";

  try {
    let logo: string | null;
    if (file instanceof File && file.size > 0) {
      logo = await saveImageToPublic(file, "brand_logos");
    } else if (removeImage) {
      logo = null;
    } else {
      const current = await getMarca(id);
      if (!current) return NextResponse.json({ error: "Brand non trovato" }, { status: 404 });
      logo = current.Logo;
    }

    const marca = await updateMarca(id, { nome, logo });
    if (!marca) return NextResponse.json({ error: "Brand non trovato" }, { status: 404 });
    return NextResponse.json({ marca });
  } catch (err) {
    console.error("[api/marche/:id PATCH]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento del brand" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  try {
    await deleteMarca(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/marche/:id DELETE]", err);
    return NextResponse.json({ error: "Errore nell'eliminazione del brand" }, { status: 500 });
  }
}
