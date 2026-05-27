import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { getSession } from "@/lib/auth";
import type { Timestamp } from "firebase-admin/firestore";

function fmtDate(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleDateString("it-IT");
}

function esc(val: unknown): string {
  const s = String(val ?? "").replace(/"/g, '""');
  return `"${s}"`;
}

export async function GET() {
  const session = await getSession();
  if (!session || session.Ruolo !== "Admin") {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  try {
    const snap = await adminDb().collection("Ordini").orderBy("DataCreazione", "desc").limit(2000).get();

    const headers = [
      "Numero", "Data", "Stato", "Source", "Cliente",
      "Totale", "IVA", "PFU", "Articoli",
      "Metodo Pagamento", "Via Fatturazione", "Citta Fatturazione",
      "Via Spedizione", "Citta Spedizione",
    ];

    const rows: string[] = [headers.map(esc).join(",")];

    for (const d of snap.docs) {
      const o = d.data();

      // Risolve nome cliente
      let clienteNome = "";
      const ref = o.Cliente ?? o.Utente;
      if (ref) {
        try {
          const cSnap = await ref.get();
          if (cSnap.exists) {
            const c = cSnap.data();
            clienteNome = c.Azienda && c.Ragione_Sociale ? c.Ragione_Sociale : (c.Nome?.trim() || c.Email || "");
          }
        } catch { /* ignora */ }
      }

      const articoli = (o.Articoli ?? []) as Record<string, unknown>[];
      const nArticoli = articoli.map((a) => `${a.Nome ?? a.Titolo ?? ""}×${a.Quantita ?? 1}`).join("; ");

      const inFat = (o.IndirizzoFatturazione ?? {}) as Record<string, string>;
      const inSpe = (o.IndirizzoSpedizione   ?? {}) as Record<string, string>;

      const row = [
        o.Numero ?? d.id,
        fmtDate(o.DataCreazione as Timestamp),
        o.Stato ?? "",
        o.Source ?? "B2B",
        clienteNome,
        o.Totale ?? 0,
        o.IVA    ?? 0,
        o.PFU    ?? 0,
        nArticoli,
        o.MetodoPagamento ?? "",
        inFat.Via  ?? "",
        inFat.Citta ?? "",
        inSpe.Via   ?? "",
        inSpe.Citta ?? "",
      ].map(esc).join(",");

      rows.push(row);
    }

    const csv = rows.join("\r\n");
    const filename = `ordini_${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Errore export CSV" }, { status: 500 });
  }
}
