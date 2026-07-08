// Helper condivisi tra gli importer ordini (Fase 9).

/** true se l'errore di Firestore Admin SDK è ALREADY_EXISTS (da .create() su un doc esistente). */
export function isAlreadyExists(err) {
  return err?.code === 6 || err?.code === "already-exists" || /already exists/i.test(err?.message ?? "");
}
