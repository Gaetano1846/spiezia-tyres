import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { updatePopup, deletePopup } from "@/lib/popupDb";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  let body: { titolo?: string; descrizione?: string; immagine?: string; link?: string; buttonText?: string; attivo?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  try {
    const popup = await updatePopup(id, {
      titolo: body.titolo?.trim(),
      descrizione: body.descrizione?.trim(),
      immagine: body.immagine?.trim(),
      link: body.link?.trim(),
      buttonText: body.buttonText?.trim(),
      attivo: body.attivo,
    });
    if (!popup) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
    return NextResponse.json({ popup });
  } catch (err) {
    console.error("[api/popup/:id PATCH]", err);
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
    await deletePopup(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/popup/:id DELETE]", err);
    return NextResponse.json({ error: "Errore nell'eliminazione" }, { status: 500 });
  }
}
