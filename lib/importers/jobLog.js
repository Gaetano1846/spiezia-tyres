// Osservabilità per gli importer ordini (Fase 9) — un record per run,
// aggiornato a fine elaborazione. Migrato da Firestore ImportJobs a Postgres
// b2b.import_jobs (Spiezia-DB/migrations/023_import_jobs.sql): stessa forma
// dei campi, stessa interfaccia per le 10 route chiamanti — nessuna di
// quelle route cambia, solo l'implementazione qui sotto.

import { getDb, newId } from "@/lib/db";

/**
 * @param {string} source - "adtyres" | "tyre24-anonimo" | "tyre24-regular" | "woo" | "ebay" | "bridgestone-stock" | "pirelli-stock" | "fido-sync" | "prodotti-csv-export" | "adtyres-csv-export"
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<{ id: string }>}
 */
export async function startImportJob(source, opts = {}) {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const id = newId();
  await db.query(
    `INSERT INTO b2b.import_jobs (id, source, dry_run) VALUES ($1, $2, $3)`,
    [id, source, Boolean(opts.dryRun)]
  );
  return { id };
}

/**
 * @param {{ id: string }} jobRef
 * @param {{ processedCount: number, newCount: number, updatedCount: number, skippedCount: number, errors: Array<{ id?: string, message: string }> }} result
 */
export async function finishImportJob(jobRef, result) {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const errors = result.errors ?? [];
  await db.query(
    `UPDATE b2b.import_jobs SET
       status = $2,
       processed_count = $3,
       new_count = $4,
       updated_count = $5,
       skipped_count = $6,
       error_count = $7,
       errors = $8::jsonb,
       finished_at = now(),
       updated_at = now()
     WHERE id = $1`,
    [
      jobRef.id,
      errors.length > 0 ? "done_with_errors" : "done",
      result.processedCount ?? 0,
      result.newCount ?? 0,
      result.updatedCount ?? 0,
      result.skippedCount ?? 0,
      errors.length,
      JSON.stringify(errors),
    ]
  );
}

/** Job fallito prima di poter processare qualunque ordine (es. SFTP/API irraggiungibile). */
export async function failImportJob(jobRef, error) {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(
    `UPDATE b2b.import_jobs SET
       status = 'error',
       error_message = $2,
       finished_at = now(),
       updated_at = now()
     WHERE id = $1`,
    [jobRef.id, error instanceof Error ? error.message : String(error)]
  );
}
