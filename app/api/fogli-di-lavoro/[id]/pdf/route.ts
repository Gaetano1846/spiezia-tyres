import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM } from "@/lib/auth";
import { updateFoglioPdf } from "@/lib/fogliDb";
import { saveBufferToPrivate } from "@/lib/storage";

export const runtime = "nodejs";

// POST multipart (file=PDF) — decommissioning finale Firebase: sostituisce
// l'upload diretto a Firebase Storage (foglidilavoro/) della pagina stampa.
// Salva su disco locale VPS (privato, dati cliente/veicolo/targa) e
// aggiorna PdfUrl in un'unica richiesta.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "File mancante" }, { status: 400 });
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = `foglio_${id}_${Date.now()}.pdf`;
    const pdfUrl = await saveBufferToPrivate(buffer, filename, "fogli-di-lavoro");
    const foglio = await updateFoglioPdf(id, pdfUrl);
    if (!foglio) return NextResponse.json({ error: "Non trovato" }, { status: 404 });
    return NextResponse.json({ foglio });
  } catch (err) {
    console.error("[api/fogli-di-lavoro/:id/pdf POST]", err);
    return NextResponse.json({ error: "Errore nel salvataggio PDF" }, { status: 500 });
  }
}
