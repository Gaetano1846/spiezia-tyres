// Accesso Postgres al dominio Banner/Promo_Immagini (Fase 6 — cutover
// app→Postgres). b2b.banners è ora la fonte autoritativa: il bridge propaga
// a Firestore per il CRM FlutterFlow legacy.
//
// "copertina": colonna Postgres testuale, non booleana — vedi commento in
// mapping/promozioni.mjs (Spiezia-DB). Alcuni doc storici Flutter hanno una
// URL "larga" genuinamente diversa da Url (4 su 13 verificato) — esposta qui
// come CopertinaUrl per il carosello, più un booleano Copertina per il toggle
// admin ("è impostato come copertina" = copertina IS NOT NULL).

import { getDb, newId } from "@/lib/db";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface BannerApi {
  id: string;
  Url: string;
  Attivo: boolean;
  Copertina: boolean;
  CopertinaUrl?: string;
}

function rowToBanner(r: Record<string, unknown>): BannerApi {
  return {
    id: r.id as string,
    Url: (r.immagine as string) ?? "",
    Attivo: r.attivo as boolean,
    Copertina: r.copertina != null,
    CopertinaUrl: (r.copertina as string) ?? undefined,
  };
}

export async function listBanners(activeOnly = false): Promise<BannerApi[]> {
  const db = getDb();
  if (!db) return [];
  const { rows } = await db.query(
    activeOnly
      ? `SELECT * FROM b2b.banners WHERE attivo != false ORDER BY ordine NULLS LAST`
      : `SELECT * FROM b2b.banners ORDER BY ordine NULLS LAST`
  );
  return rows.map(rowToBanner);
}

export async function createBanner(url: string): Promise<BannerApi> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const id = newId();
  const { rows } = await db.query(
    `INSERT INTO b2b.banners (id, immagine, attivo) VALUES ($1,$2,true) RETURNING *`,
    [id, url]
  );
  return rowToBanner(rows[0]);
}

export async function toggleBannerAttivo(id: string): Promise<BannerApi | null> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  const { rows } = await db.query(
    `UPDATE b2b.banners SET attivo = NOT attivo WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] ? rowToBanner(rows[0]) : null;
}

/** Imposta/rimuove la copertina. Se true: solo questo banner resta con copertina (le altre si azzerano). */
export async function setBannerCopertina(id: string, value: boolean): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  if (value) {
    await db.query(`UPDATE b2b.banners SET copertina = NULL WHERE id != $1 AND copertina IS NOT NULL`, [id]);
    await db.query(`UPDATE b2b.banners SET copertina = immagine WHERE id = $1`, [id]);
  } else {
    await db.query(`UPDATE b2b.banners SET copertina = NULL WHERE id = $1`, [id]);
  }
}

export async function deleteBanner(id: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Postgres non configurato");
  await db.query(`DELETE FROM b2b.banners WHERE id = $1`, [id]);
}

const STORAGE_ROOT = "/app/storage";

/** Salva l'immagine caricata su disco locale VPS (public/, servito diretto da nginx). Ritorna la URL pubblica. */
export async function saveBannerImage(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const filename = `${newId()}.${ext}`;
  const destDir = path.join(STORAGE_ROOT, "public", "banners");
  await mkdir(destDir, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(destDir, filename), bytes);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://b2b2.spieziatyres.it";
  return `${baseUrl}/files/public/banners/${filename}`;
}
