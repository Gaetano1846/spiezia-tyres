import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { listPopups, createPopup } from "@/lib/popupDb";

export const runtime = "nodejs";

// GET/POST /api/popup — admin CRUD, sostituisce collection(db,"Pop-Up") in admin/popup.
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  try {
    const popups = await listPopups();
    return NextResponse.json({ popups });
  } catch (err) {
    console.error("[api/popup GET]", err);
    return NextResponse.json({ error: "Errore nel caricamento" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  let body: { titolo?: string; descrizione?: string; immagine?: string; link?: string; buttonText?: string; attivo?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  if (!body.titolo?.trim()) {
    return NextResponse.json({ error: "Il titolo è obbligatorio" }, { status: 400 });
  }
  try {
    const popup = await createPopup({
      titolo: body.titolo.trim(),
      descrizione: body.descrizione?.trim(),
      immagine: body.immagine?.trim(),
      link: body.link?.trim(),
      buttonText: body.buttonText?.trim(),
      attivo: body.attivo ?? true,
    });
    return NextResponse.json({ popup }, { status: 201 });
  } catch (err) {
    console.error("[api/popup POST]", err);
    return NextResponse.json({ error: "Errore nella creazione" }, { status: 500 });
  }
}
