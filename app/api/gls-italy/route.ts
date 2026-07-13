import { NextResponse } from "next/server";
import { processGlsAction, getAuthByContract, processMultipleOrders, createSpedizioniEntries } from "@/lib/gls/sdk";
import { processMarketplaceAction } from "@/lib/marketplace/sdk";
import { getSession, isAdmin, isMagazzino } from "@/lib/auth";
import { createSpedizioneJob, updateSpedizioneJobProgress, finishSpedizioneJob } from "@/lib/spedizioniDb";
import { updateOrdineStato, appendCronologia } from "@/lib/ordiniDb";
import type { SessionPayload } from "@/lib/types";

// Sostituto interno della Cloud Function `gls-italy`.
// Stesso protocollo: POST con body JSON { action, contractIndex?, ...params }.
// Gira lato server (Node) sul server Next.js, non più su Google Cloud.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // le creazioni GLS + PDF + upload possono richiedere tempo

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // La vecchia CF era pubblica (CORS *). Qui invece la maggior parte delle
  // azioni crea/chiude/elimina spedizioni reali fatturate da GLS: le
  // proteggiamo richiedendo una sessione admin. "getZplBySped" fa eccezione:
  // è una lettura (ZPL di una spedizione già creata), usata dall'app Flutter
  // magazzino per la stampa etichette — il personale di magazzino non è admin.
  const session = await getSession();
  const authorized = body.action === "getZplBySped" ? isMagazzino(session) : isAdmin(session);
  if (!authorized) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  // "processMultipleOrders" (creazione bulk etichette) può richiedere molto
  // tempo per batch grandi. Invece di tenere il client in attesa, avviamo un
  // job Postgres (b2b.spedizioni_jobs) e processiamo in background: il client
  // riceve subito il jobId e può navigare altrove seguendo il progresso via
  // polling (vedi components/layout/SpedizioniJobsWidget.tsx, Fase 4.3).
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
  const jobId = await createSpedizioneJob({
    sede: contractIndex === 0 ? "Nola" : "Roma",
    contractIndex,
    totalOrders: ordiniIds.length,
    createdBy: session?.email ?? null,
  });

  // Fire-and-forget: il container Next.js è un processo Node persistente (non
  // serverless), quindi il lavoro continua dopo l'invio della response.
  runBulkShipmentJob(jobId, contractIndex, ordiniIds).catch((error: unknown) => {
    console.error(`GLS job ${jobId} crashed:`, error);
    finishSpedizioneJob(jobId, {
      status: "error",
      error: error instanceof Error ? error.message : "Errore sconosciuto",
    }).catch(() => {});
  });

  return jobId;
}

async function runBulkShipmentJob(jobId: string, contractIndex: number, ordiniIds: string[]): Promise<void> {
  const auth = getAuthByContract(contractIndex);
  const batchResult = await processMultipleOrders(auth, ordiniIds, contractIndex, true, async (progress) => {
    await updateSpedizioneJobProgress(jobId, {
      processedOrders: progress.processedCount,
      successOrders: progress.successCount,
      failedOrders: progress.failedCount,
      failures: progress.failures,
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
  // abbiamo l'esito per-ordine e lo usiamo. Stesso helper condiviso di ogni
  // altro cambio-stato manuale (Fase 4.1) — così la voce Cronologia non manca
  // mai, anche per gli ordini spediti in bulk.
  if (successIds.length) {
    for (const ordineId of successIds) {
      await updateOrdineStato(ordineId, "In Preparazione");
      await appendCronologia(ordineId, { azione: "Stato → In Preparazione", operatore: "Sistema (spedizione GLS)" });
    }
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

  await finishSpedizioneJob(jobId, {
    status: "done",
    processedOrders: batchResult.summary.ordersProcessed,
    successOrders: batchResult.summary.ordersSuccessful,
    failedOrders: batchResult.summary.ordersFailed,
    failures: batchResult.summary.errors,
    marketplace,
  });
}
