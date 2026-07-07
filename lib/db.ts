// Pool PostgreSQL condiviso (DB di gruppo `prezzo` sulla VPS — schemi core/b2b).
// Pattern identico a prezzo-gomme: singleton, null se DATABASE_URL non è
// configurata (build Docker, dev senza DB) — i chiamanti degradano senza crash.

import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var _spieziaPgPool: Pool | null | undefined;
}

export function getDb(): Pool | null {
  if (globalThis._spieziaPgPool !== undefined) return globalThis._spieziaPgPool;

  const url = process.env.DATABASE_URL;
  if (!url) {
    globalThis._spieziaPgPool = null;
    return null;
  }

  const pool = new Pool({ connectionString: url, max: 5 });
  // un client idle resettato dal server non deve far crashare Next.js
  pool.on("error", (err) => {
    console.error("[db] pool error (ignorato):", err.message);
  });

  globalThis._spieziaPgPool = pool;
  return pool;
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** ULID compatto per nuove righe (valido come doc ID Firestore) — timestamp + random. */
export function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
}
