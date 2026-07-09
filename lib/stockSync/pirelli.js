// Sync stock Pirelli OCP (Fase 9-bis) — port 1:1 della Cloud Function
// `processPirelliOCP` (crm-3iuocs, europe-west8), sorgente reale riscaricato
// da GCP. Stessa logica: mailbox IMAP dedicata (pirelli.ocp@spieziatyres.it)
// → ultima email con allegato XLSX/CSV "Stock OCP" → parse → diff contro
// cache dell'ultimo stato noto → scrittura del solo campo `Stock_OCP` sui
// documenti Prodotti (match su CAI) via Admin SDK.
//
// Differenze dal sorgente CF originale:
//  - Cache spostata da GCS a Postgres (core.stock_sync_cache).
//  - Non portato l'indice CAI→docId precalcolato (ottimizzazione per batch
//    grandi, non necessaria al volume reale) né le modalità probe/csv-direct
//    (endpoint di debug manuale usati in fase di sviluppo della CF originale).
//  - Modalità `dryRun`: legge la mailbox e fa il parsing/diff ma NON marca
//    l'email come letta (\Seen) e NON scrive su Firestore/cache — marcare
//    un'email come letta è un effetto collaterale sulla mailbox reale, va
//    evitato durante la finestra di verifica pre-cutover.

import { ImapFlow } from "imapflow";
import * as XLSX from "xlsx";
import { simpleParser } from "mailparser";
import { parse as parseCsvSync } from "csv-parse/sync";
import { adminDb } from "../firebase-admin";
import { getDb } from "../db";

const EMAIL_USER = process.env.PIRELLI_IMAP_USER || "";
const EMAIL_PASS = process.env.PIRELLI_IMAP_PASSWORD || "";
const IMAP_HOST = process.env.PIRELLI_IMAP_HOST || "mail.your-server.de";
const IMAP_PORT = Number(process.env.PIRELLI_IMAP_PORT || 993);
const MAILBOX = process.env.PIRELLI_IMAP_MAILBOX || "INBOX";
const CACHE_SOURCE = "pirelli";

function normalizeNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(",", ".").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

async function streamToBuffer(stream) {
  const chunks = [];
  return await new Promise((resolve, reject) => {
    stream.on("data", (d) => chunks.push(Buffer.from(d)));
    stream.once("end", () => resolve(Buffer.concat(chunks)));
    stream.once("error", reject);
  });
}

function collectAttachmentParts(struct, acc = []) {
  if (!struct) return acc;
  if (Array.isArray(struct.childNodes)) {
    for (const c of struct.childNodes) collectAttachmentParts(c, acc);
  }
  const dispType = struct.disposition && struct.disposition.type ? String(struct.disposition.type).toLowerCase() : "";
  const filename =
    (struct.disposition && struct.disposition.params && struct.disposition.params.filename) ||
    (struct.params && struct.params.name) ||
    "";
  if (dispType === "attachment" || filename) {
    acc.push({ partId: struct.part, filename });
  }
  return acc;
}

function isCsvFilename(name) {
  return !!name && name.toLowerCase().includes(".csv");
}

function isXlsxFilename(name) {
  return !!name && name.toLowerCase().includes(".xlsx");
}

async function searchUnseenAttachment(client) {
  const uids = await client.search({ seen: false });
  if (!uids || !uids.length) return null;
  let best = null;
  for await (const msg of client.fetch(uids, { bodyStructure: true })) {
    const attachments = collectAttachmentParts(msg.bodyStructure, []);
    const match = attachments.find((a) => isCsvFilename(a.filename)) || attachments.find((a) => isXlsxFilename(a.filename));
    if (match && (!best || msg.uid > best.uid)) {
      best = { uid: msg.uid, partId: match.partId, filename: match.filename };
    }
  }
  return best;
}

async function searchRecentAttachment(client) {
  const exists = client.mailbox.exists || 0;
  const start = Math.max(1, exists - 200);
  let best = null;
  for await (const msg of client.fetch(`${start}:${exists}`, { bodyStructure: true })) {
    const attachments = collectAttachmentParts(msg.bodyStructure, []);
    const match = attachments.find((a) => isCsvFilename(a.filename)) || attachments.find((a) => isXlsxFilename(a.filename));
    if (match && (!best || msg.uid > best.uid)) {
      best = { uid: msg.uid, partId: match.partId, filename: match.filename };
    }
  }
  return best;
}

async function getLatestAttachmentBuffer(client, dryRun) {
  const lock = await client.getMailboxLock(MAILBOX);
  try {
    const first = await searchUnseenAttachment(client);
    const target = first || (await searchRecentAttachment(client));
    if (target) {
      const download = await client.download(target.uid, target.partId);
      const buf = await streamToBuffer(download.content);
      if (!dryRun) await client.messageFlagsAdd(target.uid, ["\\Seen"]);
      return { content: buf, filename: target.filename || "" };
    }
    // Fallback: risalita MIME manuale sulle ultime 10 email (nessun match via bodyStructure).
    const exists = client.mailbox.exists || 0;
    const start = Math.max(1, exists - 10);
    const begin = Date.now();
    let best = null;
    for await (const msg of client.fetch(`${start}:${exists}`, { source: true })) {
      if (!msg.source) continue;
      const raw = Buffer.isBuffer(msg.source) ? msg.source : await streamToBuffer(msg.source);
      const parsed = await simpleParser(raw);
      if (parsed.attachments && parsed.attachments.length) {
        const attCsv = parsed.attachments.find((a) => isCsvFilename(a.filename));
        const attXlsx = parsed.attachments.find((a) => isXlsxFilename(a.filename));
        const att = attCsv || attXlsx;
        if (att && att.content && (!best || msg.uid > best.uid)) {
          best = { uid: msg.uid, content: Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content), filename: att.filename || "" };
        }
      }
      if (Date.now() - begin > 45000) break;
    }
    if (best) {
      if (!dryRun) await client.messageFlagsAdd(best.uid, ["\\Seen"]);
      return { content: best.content, filename: best.filename };
    }
    return null;
  } finally {
    lock.release();
  }
}

function extractRowsByArray(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const out = [];
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const ip = r[2];
    if (ip && String(ip).toLowerCase().includes("ip") && String(r[3] || "").toLowerCase().includes("stock")) continue;
    if (ip !== null && ip !== undefined && String(ip).trim() !== "") {
      out.push({ ipCode: String(ip).trim(), stock: normalizeNumber(r[3]) });
    }
  }
  return out;
}

function extractRowsByHeader(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  return rows
    .map((r) => {
      const keys = Object.keys(r);
      const kIp = keys.find((k) => k.toLowerCase().includes("ip code")) || "IP Code";
      const kStock = keys.find((k) => k.toLowerCase().includes("stock disponibil")) || "Stock Disponibile";
      const ip = r[kIp];
      return { ipCode: ip ? String(ip).trim() : null, stock: normalizeNumber(r[kStock]) };
    })
    .filter((x) => x.ipCode);
}

function extractRowsCsv(buffer) {
  const text = buffer.toString("utf8");
  const rows = parseCsvSync(text, { columns: false, skip_empty_lines: true, trim: true, delimiter: ";" });
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r) || r.length < 4) continue;
    const ipHeader = String(r[2] || "").toLowerCase();
    const stockHeader = String(r[3] || "").toLowerCase();
    if (i === 0 && (ipHeader.includes("ip") || stockHeader.includes("stock"))) continue;
    const ip = r[2];
    if (ip !== null && ip !== undefined && String(ip).trim() !== "") {
      out.push({ ipCode: String(ip).trim(), stock: normalizeNumber(r[3]) });
    }
  }
  return out;
}

function extractRows(att) {
  if (att.filename && att.filename.toLowerCase().includes(".csv")) return extractRowsCsv(att.content);
  const a = extractRowsByArray(att.content);
  if (a && a.length) return a;
  return extractRowsByHeader(att.content);
}

async function detectCaiType(db) {
  const snap = await db.collection("Prodotti").limit(1).get();
  if (snap.empty) return null;
  const v = snap.docs[0].get("CAI");
  const t = typeof v;
  return t === "number" || t === "string" ? t : null;
}

async function readCache() {
  const pool = getDb();
  if (!pool) return {};
  const { rows } = await pool.query("SELECT data FROM core.stock_sync_cache WHERE source = $1", [CACHE_SOURCE]);
  return rows.length > 0 ? rows[0].data : {};
}

async function writeCache(data) {
  const pool = getDb();
  if (!pool) return;
  await pool.query(
    `INSERT INTO core.stock_sync_cache (source, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (source) DO UPDATE SET data = $2, updated_at = now()`,
    [CACHE_SOURCE, JSON.stringify(data)]
  );
}

async function updateFirestore(changedPairs) {
  const db = adminDb();
  const caiType = await detectCaiType(db);
  const convert = (v) => {
    if (caiType === "number") {
      const n = Number(v);
      return Number.isNaN(n) ? null : n;
    }
    return caiType === "string" ? String(v) : v;
  };
  const map = new Map();
  for (const { ipCode, stock } of changedPairs) map.set(ipCode, stock);
  const ips = Array.from(map.keys());

  let totalMatched = 0;
  for (let i = 0; i < ips.length; i += 10) {
    const groupRaw = ips.slice(i, i + 10);
    const group = groupRaw.map(convert).filter((x) => x !== null && x !== undefined);
    if (group.length === 0) continue;
    const snap = await db.collection("Prodotti").where("CAI", "in", group).get();
    if (snap.empty) continue;
    const batch = db.batch();
    for (const doc of snap.docs) {
      const cai = doc.get("CAI");
      const stock = map.get(String(cai));
      if (stock !== undefined) batch.update(doc.ref, { Stock_OCP: stock });
    }
    await batch.commit();
    totalMatched += snap.size;
  }
  return totalMatched;
}

/**
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function runPirelliOcpSync(opts = {}) {
  const { dryRun = false } = opts;
  if (!EMAIL_USER || !EMAIL_PASS) throw new Error("PIRELLI_IMAP_USER / PIRELLI_IMAP_PASSWORD mancanti");

  const client = new ImapFlow({ host: IMAP_HOST, port: IMAP_PORT, secure: true, auth: { user: EMAIL_USER, pass: EMAIL_PASS }, logger: false });
  await client.connect();
  let att;
  try {
    await client.mailboxOpen(MAILBOX);
    att = await getLatestAttachmentBuffer(client, dryRun);
  } finally {
    await client.logout();
  }

  if (!att) {
    return { processedCount: 0, newCount: 0, updatedCount: 0, skippedCount: 0, errors: [], message: "Nessun allegato XLSX/CSV trovato" };
  }

  const rows = extractRows(att);
  const cache = await readCache();

  const changed = [];
  for (const { ipCode, stock } of rows) {
    const prev = Object.prototype.hasOwnProperty.call(cache, ipCode) ? cache[ipCode] : null;
    if (prev === null || prev !== stock) changed.push({ ipCode, stock });
  }

  if (dryRun) {
    return {
      processedCount: rows.length,
      newCount: 0,
      updatedCount: 0,
      skippedCount: rows.length - changed.length,
      errors: [],
      dryRunChanged: changed.length,
      dryRunSample: changed.slice(0, 15),
      dryRunFilename: att.filename,
    };
  }

  const updatedCount = changed.length ? await updateFirestore(changed) : 0;
  for (const { ipCode, stock } of changed) cache[ipCode] = stock;
  await writeCache(cache);

  return { processedCount: rows.length, newCount: 0, updatedCount, skippedCount: rows.length - changed.length, errors: [] };
}
