import { NextResponse, type NextRequest } from "next/server";
import { getSession, isCRM } from "@/lib/auth";

export const runtime = "nodejs";

// GET /api/files/:path* — serve i file privati migrati da Firebase Storage
// (Fase 6: etichette spedizione, PDF fogli/preventivi/ordini — contengono dati
// cliente, mai esposti senza sessione). Verifica la sessione poi delega la
// consegna vera e propria a nginx via X-Accel-Redirect (location interna
// /files/private/, mai raggiungibile direttamente) — zero traffico file
// attraverso il processo Node.

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  zpl: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await getSession();
  if (!session || !isCRM(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const { path: segments } = await params;
  if (!segments?.length || segments.some((s) => s.includes("..") || s.includes("/"))) {
    return NextResponse.json({ error: "Percorso non valido" }, { status: 400 });
  }

  const relPath = segments.join("/");
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  return new NextResponse(null, {
    status: 200,
    headers: {
      "X-Accel-Redirect": `/files/private/${relPath}`,
      "Content-Type": contentType,
    },
  });
}
