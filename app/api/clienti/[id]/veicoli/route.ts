import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM } from "@/lib/auth";
import { listVeicoli, createVeicolo } from "@/lib/clientiDb";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  const veicoli = await listVeicoli(id);
  return NextResponse.json({ veicoli });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }
  const targa = typeof body.Targa === "string" ? body.Targa.trim() : "";
  if (!targa) return NextResponse.json({ error: "Targa obbligatoria" }, { status: 400 });

  try {
    const veicolo = await createVeicolo(id, {
      Targa: targa,
      Marca: typeof body.Marca === "string" ? body.Marca : undefined,
      Modello: typeof body.Modello === "string" ? body.Modello : undefined,
      Anno: typeof body.Anno === "number" ? body.Anno : undefined,
      Km: typeof body.Km === "number" ? body.Km : undefined,
      Note: typeof body.Note === "string" ? body.Note : undefined,
    });
    return NextResponse.json({ veicolo });
  } catch (err) {
    console.error("[api/clienti/:id/veicoli POST]", err);
    return NextResponse.json({ error: "Errore nella creazione del veicolo" }, { status: 500 });
  }
}
