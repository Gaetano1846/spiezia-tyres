import { NextResponse } from "next/server";
import { verifyInternalSecret } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import { processIndividualOrder, getOrderFilesFromFTP, getLastRunTimestamp } from "@/lib/importers/tyre24Regular";

// TEMP — verifica write-path reale per Tyre24 Regular (Fase 9) prima del
// cutover. Trova il primo ordine genuinamente nuovo (non ancora in Firestore)
// tra i file FTP pendenti e lo processa con scrittura reale (dryRun:false),
// SENZA MAI avanzare il cursore System/Tyre24Import.lastProcessedAt (che
// resta di proprietà della Cloud Function GCP finché non c'è il cutover
// formale) — usa solo la lettura FTP + processIndividualOrder esportati,
// mai la funzione di entry point runTyre24RegularImport. Da rimuovere dopo
// la verifica.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!verifyInternalSecret(req)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const db = adminDb();
  const lastRunTime = await getLastRunTimestamp(db);
  const { files } = await getOrderFilesFromFTP(lastRunTime);

  for (const fileData of files) {
    if (!fileData.data || !Array.isArray(fileData.data)) continue;
    for (const order of fileData.data) {
      const existing = await db.collection("Ordini").doc(order.order).get();
      if (!existing.exists) {
        const result = await processIndividualOrder(db, order, false);
        return NextResponse.json({ found: true, filesChecked: files.length, ...result });
      }
    }
  }

  return NextResponse.json({ found: false, filesChecked: files.length });
}
