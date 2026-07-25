import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { getModello, updateModello, deleteModello } from "@/lib/modelliDb";
import { saveImageToPublic } from "@/lib/storage";

export const runtime = "nodejs";

// PATCH — multipart/form-data: nome (required), file (opzionale, nuova
// immagine), removeImage ("true" per rimuovere l'immagine esistente).
// Sostituisce updateDoc(modelloRef, {Nome, Sinonimo: arrayUnion(...), Immagine}).
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
  if (!nome) return NextResponse.json({ error: "Nome disegno mancante" }, { status: 400 });

  const file = form.get("file");
  const removeImage = form.get("removeImage") === "true";

  try {
    let immagine: string | null;
    if (file instanceof File && file.size > 0) {
      immagine = await saveImageToPublic(file, "disegni");
    } else if (removeImage) {
      immagine = null;
    } else {
      const current = await getModello(id);
      if (!current) return NextResponse.json({ error: "Disegno non trovato" }, { status: 404 });
      immagine = current.Immagine;
    }

    const modello = await updateModello(id, { nome, immagine });
    if (!modello) return NextResponse.json({ error: "Disegno non trovato" }, { status: 404 });
    return NextResponse.json({ modello });
  } catch (err) {
    console.error("[api/modelli/:id PATCH]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento del disegno" }, { status: 500 });
  }
}

// DELETE — usata dal CRUD leggero in admin/catalogo (nessuna gestione
// immagine lì, solo Nome). admin/disegni non offre delete.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  try {
    await deleteModello(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/modelli/:id DELETE]", err);
    return NextResponse.json({ error: "Errore nell'eliminazione del disegno" }, { status: 500 });
  }
}
