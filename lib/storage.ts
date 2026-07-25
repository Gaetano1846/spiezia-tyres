// Helper condiviso per il salvataggio di file su disco locale VPS (Fase 6
// storage — non più Firebase Storage). Estratto da
// lib/bannerDb.ts::saveBannerImage (comportamento identico per i banner,
// stesso STORAGE_ROOT/URL pubblica) e generalizzato con una sottocartella
// parametrica, riusato da lib/modelliDb.ts (disegni), lib/marcheDb.ts
// (loghi brand) e lib/gls/sdk.js (etichette ZPL/PDF, private — vedi sotto).

import { newId } from "@/lib/db";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const STORAGE_ROOT = "/app/storage";

async function writeToStorage(area: "public" | "private", subdir: string, filename: string, bytes: Buffer): Promise<void> {
  const destDir = path.join(STORAGE_ROOT, area, subdir);
  await mkdir(destDir, { recursive: true });
  await writeFile(path.join(destDir, filename), bytes);
}

/** Salva un'immagine caricata su disco locale VPS sotto public/<subdir>/, servito diretto da nginx. Ritorna la URL pubblica. */
export async function saveImageToPublic(file: File, subdir: string): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const filename = `${newId()}.${ext}`;
  await writeToStorage("public", subdir, filename, Buffer.from(await file.arrayBuffer()));
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://b2b2.spieziatyres.it";
  return `${baseUrl}/files/public/${subdir}/${filename}`;
}

/**
 * Salva un buffer generato server-side (non un upload utente) su disco locale
 * VPS sotto private/<subdir>/<filename> — contenuto con dati cliente (es.
 * etichette spedizione GLS: nome/indirizzo destinatario), mai pubblico.
 * Ritorna la URL servita da app/api/files/[...path]/route.ts (sessione CRM
 * richiesta, X-Accel-Redirect a nginx, stesso pattern dei file privati già
 * migrati in Fase 6).
 */
export async function saveBufferToPrivate(buffer: Buffer, filename: string, subdir: string): Promise<string> {
  await writeToStorage("private", subdir, filename, buffer);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://b2b2.spieziatyres.it";
  return `${baseUrl}/api/files/${subdir}/${filename}`;
}
