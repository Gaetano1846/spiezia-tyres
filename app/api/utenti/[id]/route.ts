import { NextRequest, NextResponse } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { updateUtenteAccount } from "@/lib/utentiDb";

export const runtime = "nodejs";

// PATCH /api/utenti/[id] — admin/clienti: aggiornamento account (Ruolo, nome,
// Rappresentante, Metodo di pagamento, Blocco, Fido-fallback per utenti senza
// Cliente collegato). Sostituisce updateDoc(doc(db,"users",id),...) diretto.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Body non valido" }, { status: 400 });

  try {
    await updateUtenteAccount(id, {
      Ruolo: typeof body.Ruolo === "string" ? body.Ruolo : undefined,
      DisplayName: typeof body.DisplayName === "string" ? body.DisplayName : undefined,
      Rappresentante: typeof body.Rappresentante === "string" ? body.Rappresentante : undefined,
      MetodoPagamento: typeof body.MetodoPagamento === "string" ? body.MetodoPagamento : undefined,
      Blocco: typeof body.Blocco === "boolean" ? body.Blocco : undefined,
      Fido: typeof body.Fido === "number" ? body.Fido : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/utenti/[id] PATCH]", err);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}
