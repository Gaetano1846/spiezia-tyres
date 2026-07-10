import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { processGlsAction, getAuthByContract, processMultipleOrders, createSpedizioniEntries } from "@/lib/gls/sdk";
import { processMarketplaceAction } from "@/lib/marketplace/sdk";
import { getSession, isAdmin } from "@/lib/auth";
import { adminDb } from "@/lib/firebase-admin";
import type { SessionPayload } from "@/lib/types";

// Sostituto interno della Cloud Function `gls-italy`.
// Stesso protocollo: POST con body JSON { action, contractIndex?, ...params }.
// Gira lato server (Node) sul server Next.js, non più su Google Cloud.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // le creazioni GLS + PDF + upload possono richiedere tempo

export async function POST(req: Request) {
  // La vecchia CF era pubblica (CORS *). Qui invece crea spedizioni reali:
  // la proteggiamo richiedendo una sessione admin.
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // "processMultipleOrders" (creazione bulk etichette) può richiedere molto
  // tempo per batch grandi. Invece di tenere il client in attesa, avviamo un
  // job Firestore (SpedizioniJobs) e processiamo in background: il client
  // riceve subito il jobId e può navigare altrove seguendo il progresso live
  // via onSnapshot (vedi components/admin/SpedizioniJobsWidget.tsx).
  if (body.action === "processMultipleOrders") {
    const ordiniIds = Array.isArray(body.ordiniIds) ? (body.ordiniIds as string[]) : [];
    if (ordiniIds.length === 0) {
      return NextResponse.json({ error: "Array di ordiniIds richiesto" }, { status: 400 });
    }
    const contractIndex = typeof body.contractIndex === "number" ? body.contractIndex : 0;
    const jobId = await startBulkShipmentJob(contractIndex, ordiniIds, session);
    return NextResponse.json({ success: true, jobId }, { status: 202 });
  }

  const { statusCode, payload } = await processGlsAction(body);
  return NextResponse.json(payload, { status: statusCode });
}

async function startBulkShipmentJob(
  contractIndex: number,
  ordiniIds: string[],
  session: SessionPayload | null
): Promise<string> {
  const db = adminDb();
  const jobRef = db.collection("SpedizioniJobs").doc();
  const now = Timestamp.now();

  await jobRef.set({
    tipo: "GLS",
    sede: contractIndex === 0 ? "Nola" : "Roma",
    contractIndex,
    totalOrders: ordiniIds.length,
    processedOrders: 0,
    successOrders: 0,
    failedOrders: 0,
    failures: [],
    status: "running",
    createdBy: session?.email ?? null,
    createdAt: now,
    updatedAt: now,
  });

  // Fire-and-forget: il container Next.js è un processo Node persistente (non
  // serverless), quindi il lavoro continua dopo l'invio della response.
  runBulkShipmentJob(jobRef.id, contractIndex, ordiniIds).catch((error: unknown) => {
    console.error(`GLS job ${jobRef.id} crashed:`, error);
    jobRef.update({
      status: "error",
      error: error instanceof Error ? error.message : "Errore sconosciuto",
      updatedAt: Timestamp.now(),
    }).catch(() => {});
  });

  return jobRef.id;
}

async function runBulkShipmentJob(jobId: string, contractIndex: number, ordiniIds: string[]): Promise<void> {
  const db = adminDb();
  const jobRef = db.collection("SpedizioniJobs").doc(jobId);

  const auth = getAuthByContract(contractIndex);
  const batchResult = await processMultipleOrders(auth, ordiniIds, contractIndex, true, async (progress) => {
    await jobRef.update({
      processedOrders: progress.processedCount,
      successOrders: progress.successCount,
      failedOrders: progress.failedCount,
      failures: progress.failures,
      updatedAt: Timestamp.now(),
    });
  });

  type OrderResult = { orderId: string; status: string; allParcelIds?: string[]; ordiniIdForBda?: string; destinationName?: string };
  const results = batchResult.results as OrderResult[];

  const toCreate: { parcelId: string; bda?: string; orderRef: string; destinationName: string | null; contractIndex: number }[] = [];
  results.forEach((r) => {
    if (r.status === "success" && r.allParcelIds) {
      r.allParcelIds.forEach((id) => {
        toCreate.push({
          parcelId: id,
          bda: r.ordiniIdForBda,
          orderRef: r.orderId,
          destinationName: r.destinationName || null,
          contractIndex,
        });
      });
    }
  });
  if (toCreate.length) await createSpedizioniEntries(toCreate);

  const successIds = results.filter((r) => r.status === "success").map((r) => r.orderId);

  // Mirror FF: dopo la creazione GLS ogni ordine spedito passa a
  // "In Preparazione" (nel FF: reference.update(stato) subito dopo
  // ProcessMultipleOrdersGLS, PRIMA del push marketplace). Solo gli ordini
  // riusciti — il FF li marcava tutti se la bulk call rispondeva ok, qui
  // abbiamo l'esito per-ordine e lo usiamo.
  if (successIds.length) {
    const statoBatch = db.batch();
    for (const ordineId of successIds) {
      statoBatch.update(db.collection("Ordini").doc(ordineId), {
        Stato: "In Preparazione",
        DataAggiornamento: Timestamp.now(),
      });
    }
    await statoBatch.commit();
  }

  // Mirror FF: dopo la creazione GLS, comunica il tracking ai marketplace
  // (stesso step che prima girava client-side dopo l'attesa del batch).
  const marketplace = { ok: 0, ko: 0, skipped: 0 };
  if (successIds.length) {
    const settled = await Promise.allSettled(
      successIds.map((ordineId) => processMarketplaceAction({ action: "pushTracking", ordineId, corriere: "GLS" }))
    );
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value.statusCode === 200) {
        const d = (s.value.payload as { data?: { ok?: boolean; skipped?: boolean } })?.data;
        if (d?.skipped) marketplace.skipped++;
        else if (d?.ok) marketplace.ok++;
        else marketplace.ko++;
      } else {
        marketplace.ko++;
      }
    }
  }

  await jobRef.update({
    status: "done",
    processedOrders: batchResult.summary.ordersProcessed,
    successOrders: batchResult.summary.ordersSuccessful,
    failedOrders: batchResult.summary.ordersFailed,
    failures: batchResult.summary.errors,
    marketplace,
    finishedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
}
