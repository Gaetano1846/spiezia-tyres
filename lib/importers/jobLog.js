// Osservabilità per gli importer ordini (Fase 9) — stesso pattern già in
// produzione per SpedizioniJobs (vedi app/api/gls-italy/route.ts): un
// documento per run, aggiornato a fine elaborazione, consultabile da Firestore
// senza bisogno di una UI dedicata nuova.

import { adminDb } from "../firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

/**
 * @param {string} source - "adtyres" | "tyre24-anonimo" | "tyre24-regular" | "woo" | "bridgestone-stock" | "pirelli-stock" | "fido-sync" | "prodotti-csv-export"
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function startImportJob(source, opts = {}) {
  const db = adminDb();
  const jobRef = db.collection("ImportJobs").doc();
  const now = Timestamp.now();
  await jobRef.set({
    source,
    dryRun: Boolean(opts.dryRun),
    status: "running",
    processedCount: 0,
    newCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    errors: [],
    startedAt: now,
    updatedAt: now,
  });
  return jobRef;
}

/**
 * @param {FirebaseFirestore.DocumentReference} jobRef
 * @param {{ processedCount: number, newCount: number, updatedCount: number, skippedCount: number, errors: Array<{ id?: string, message: string }> }} result
 */
export async function finishImportJob(jobRef, result) {
  const errors = result.errors ?? [];
  await jobRef.update({
    status: errors.length > 0 ? "done_with_errors" : "done",
    processedCount: result.processedCount ?? 0,
    newCount: result.newCount ?? 0,
    updatedCount: result.updatedCount ?? 0,
    skippedCount: result.skippedCount ?? 0,
    errorCount: errors.length,
    errors,
    finishedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
}

/** Job fallito prima di poter processare qualunque ordine (es. SFTP/API irraggiungibile). */
export async function failImportJob(jobRef, error) {
  await jobRef.update({
    status: "error",
    error: error instanceof Error ? error.message : String(error),
    finishedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
}
