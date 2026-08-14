// Import ordini tyre-world.de (Fase 9-bis) — stesso schema/pattern di
// lib/importers/zr07.js, ma sorgente diversa: qui l'XML arriva via FTPS su
// un account NOSTRO (dedi6194.your-server.de, utente spiezi_19), non un
// account del distributore — tyre-world.de scrive direttamente in root,
// formato "TopM Warenwirtschaftssystem" (<bestellung>), non l'"<order>" di
// 07ZR/AdTyres. Un solo account, non un array di mercati.
//
// Scoperto 2026-08-13: la root conteneva ~1040 ordini reali storici
// (2020-2024, stesso mittente "B. Fuhrmann Einzelhandel GmbH" /
// info@tyre-world.de, verificato aprendo più file) mai automatizzati —
// gestiti a mano dall'utente fino ad oggi (confermato con l'utente). Spostati
// manualmente in /archivio-storico PRIMA del cutover di questo importer: non
// vanno riprocessati, l'importer parte da zero sui soli file nuovi che
// arrivano da qui in poi.
//
// Cliente: tyre-world.de è sempre lo stesso account B2B (dati fissi in
// <rechnungsadresse>, stesso IBAN/UStID su ogni ordine ispezionato) — id
// deterministico TYREWORLD_{ustid}, stesso schema di ZR07_{partitaIva}/
// ADT_{ustid}. Il vero destinatario finale (dropship, <neutralversand>true)
// sta in <lieferadresse> e va solo nell'indirizzo di spedizione dell'ordine,
// non come cliente separato — stessa scelta già fatta per AdTyres/07ZR
// (ClienteId = reseller, non il cliente finale; vedi FONTI_NOME_DA_SPEDIZIONE
// in admin/ordini/page.tsx, dove "TyreWorld" è stata aggiunta allo stesso
// set di AdTyres/Prezzo-Gomme).
//
// Articolo: <artnr> — il commento XML lo descrive come ID interno del
// gestionale TopM del partner, non esplicitamente il nostro SKU. Stesso
// lookup Firestore Prodotti.SKU per PFU/titolo/ref_path già usato da
// zr07.js/adtyres.js, con lo stesso fallback "non trovato → ref_path null,
// pfu 0, titolo dalla XML": se il match fallisce l'ordine si crea comunque,
// solo senza arricchimento. Da riverificare durante il primo dry-run reale.
//
// Totale/IVA: il formato non fornisce né un totale ordine né l'IVA (a
// differenza di 07ZR) — totale = somma prezzo*quantità delle righe, iva
// sempre 0 (stesso comportamento di AdTyres, stesso motivo: il partner non
// la espone).
//
// Pagamento: nessun blocco pagamento nell'XML (a differenza del SEPA di
// 07ZR) — pagamento minimale generico, stessa forma condivisa
// (Nome/ID/Descrizione/Costo/Costo_Extra) attesa dal resto della UI.

import { Client as FtpClient } from "basic-ftp";
import { Writable } from "node:stream";
import { parseStringPromise } from "xml2js";
import { adminDb } from "../firebase-admin";
import { isAlreadyExists } from "./util";
import { resolveOrCreateClientePg, insertOrderPg, orderExistsPg, insertCronologiaPg } from "./tyre24PgWrite";

// Stessa soglia di zr07.js/adtyres.js — un file genuinamente malformato non
// deve essere ritentato all'infinito ad ogni run.
const QUARANTINE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 giorni

/* ── helpers (identici a zr07.js, per coerenza col parsing xml2js) ── */

function t(node) {
  if (!node) return "";
  if (Array.isArray(node)) return t(node[0]);
  if (typeof node === "object" && node._) return String(node._).trim();
  return String(node).trim();
}

function num(node) {
  const v = parseFloat(t(node));
  return Number.isFinite(v) ? v : 0;
}

/* ── customer processing ─────────────────────────────────────────── */

async function processCustomer(rechnungsadresse, dryRun) {
  const ustid = t(rechnungsadresse.ustid);
  const kundennummer = t(rechnungsadresse.kundennummer);
  const clienteId = ustid ? `TYREWORLD_${ustid}` : `TYREWORLD_${kundennummer || "unknown"}`;

  if (dryRun) return clienteId;

  await resolveOrCreateClientePg(clienteId, {
    nome: t(rechnungsadresse.name),
    ragioneSociale: t(rechnungsadresse.name),
    email: t(rechnungsadresse.email),
    telefono: t(rechnungsadresse.telefon),
    via: t(rechnungsadresse.strasse),
    citta: t(rechnungsadresse.ort),
    cap: t(rechnungsadresse.plz),
    paese: t(rechnungsadresse.land) || t(rechnungsadresse.lkz),
    partitaIva: ustid,
    codiceFiscale: t(rechnungsadresse.steuernummer),
    azienda: true,
    b2b: true,
    tipo: "B2B",
    source: "TyreWorld",
  });
  return clienteId;
}

function addressFrom(node) {
  return {
    Via: t(node.strasse),
    Citta: t(node.ort),
    CAP: t(node.plz),
    Telefono: t(node.telefon),
    Destinatario: t(node.name),
    Paese: t(node.land) || t(node.lkz),
  };
}

/* ── article processing ──────────────────────────────────────────── */

async function processArticles(db, positions) {
  const articoli = [];
  const items = Array.isArray(positions) ? positions : [positions];

  for (const item of items) {
    const sku = t(item.artnr);
    const quantity = num(item.menge);
    const unitPrice = num(item.preis);
    const description = t(item.bezeichnung);

    let refPath = null;
    let pfu = 0;
    let titolo = description;

    if (sku) {
      const snap = await db.collection("Prodotti").where("SKU", "==", sku).limit(1).get();
      if (!snap.empty) {
        const doc = snap.docs[0];
        refPath = doc.ref.path;
        const data = doc.data();
        pfu = data.PFU || 0;
        titolo = data.Titolo || description;
      }
    }

    const totRiga = +(unitPrice * quantity).toFixed(2);
    articoli.push({
      ref_path: refPath,
      titolo,
      sku,
      contributo_logistico: 0,
      prezzo_unitario: unitPrice,
      quantita: quantity,
      pfu,
      tot_riga: totRiga,
      fs_extra: {},
    });
  }

  return articoli;
}

/* ── single XML order processing ─────────────────────────────────── */

// Esportata (oltre che usata internamente) per test di idempotenza, stesso
// motivo di zr07.js::processXmlOrder.
export async function processXmlOrder(db, xmlContent, fileName, dryRun) {
  const parsed = await parseStringPromise(xmlContent, { explicitArray: false, trim: true });
  const order = parsed.bestellung;
  if (!order) throw new Error(`No <bestellung> root in ${fileName}`);

  const orderNumber = t(order.bestellnummer);
  if (!orderNumber) throw new Error(`Missing bestellnummer in ${fileName}`);
  const orderDocId = `TYREWORLD-${orderNumber}`;

  const dateRaw = t(order.bestelldatum);
  const creationDate = dateRaw ? new Date(dateRaw.replace(" ", "T")) : new Date();

  // Fast-path idempotenza (come zr07.js/adtyres.js): evita di risolvere
  // cliente/articoli per niente se l'ordine esiste già.
  if (dryRun) {
    const exists = await orderExistsPg(orderDocId);
    return { orderDocId, skipped: exists };
  }
  if (await orderExistsPg(orderDocId)) return { orderDocId, skipped: true };

  const rechnungsadresse = order.rechnungsadresse || {};
  const lieferadresse = order.lieferadresse || {};

  const clienteId = await processCustomer(rechnungsadresse, dryRun);
  const billingAddr = addressFrom(rechnungsadresse);
  const shippingAddr = addressFrom(lieferadresse);

  const positions = order.positionen?.pos;
  const articoli = positions ? await processArticles(db, positions) : [];

  const totale = +articoli.reduce((s, a) => s + a.tot_riga, 0).toFixed(2);
  const totalePFU = articoli.reduce((s, a) => s + a.pfu * a.quantita, 0);

  let result;
  try {
    result = await insertOrderPg(
      orderDocId,
      {
        source: "TyreWorld",
        stato: "In Lavorazione",
        clienteId,
        totale,
        iva: 0,
        pfu: +totalePFU.toFixed(2),
        pagamento: { Nome: "Tyre-World.de", ID: "", Descrizione: "Ordine partner Tyre-World.de", Costo: 0, Costo_Extra: 0 },
        indirizzoFatturazione: billingAddr,
        indirizzoSpedizione: shippingAddr,
        note: "",
        t24Country: t(lieferadresse.lkz) || t(rechnungsadresse.lkz),
        dataOra: creationDate,
        createdAt: new Date(),
        fsExtra: {
          TYREWORLD_OrderNumber: orderNumber,
          TYREWORLD_Neutralversand: t(order.neutralversand),
          TYREWORLD_Bemerkung: t(order.bemerkung),
          TYREWORLD_BemerkungInterna: t(order.bemerkungintern),
          TYREWORLD_FileName: fileName,
        },
      },
      articoli
    );
  } catch (err) {
    if (isAlreadyExists(err)) return { orderDocId, skipped: true };
    throw err;
  }

  if (result.skipped) return { orderDocId, skipped: true };

  await insertCronologiaPg(orderDocId, "Ordine importato automaticamente da Tyre-World.de.");

  return { orderDocId, skipped: false };
}

/* ── FTP transport ────────────────────────────────────────────────── */

function collectToBuffer() {
  const chunks = [];
  const writable = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  return { writable, getBuffer: () => Buffer.concat(chunks) };
}

async function runFtpImport(db, dryRun, force) {
  const host = process.env.TYREWORLD_ORDERS_FTP_HOST;
  const user = process.env.TYREWORLD_ORDERS_FTP_USER;
  const password = process.env.TYREWORLD_ORDERS_FTP_PASSWORD;
  const result = { processedCount: 0, newCount: 0, updatedCount: 0, skippedCount: 0, quarantinedCount: 0, errors: [] };

  if (!host || !user || !password) {
    result.errors.push({ id: "tyreworld", message: "TYREWORLD_ORDERS_FTP_HOST/USER/PASSWORD mancanti" });
    return result;
  }

  // I file arrivano direttamente in root (nessuna sottocartella /orders come
  // per 07ZR) — processed/errors sono sottocartelle create da questo
  // importer, sorelle di /archivio-storico.
  const processedDir = "/processed";
  const errorsDir = "/errors";

  const client = new FtpClient();
  client.ftp.verbose = false;
  try {
    // Richiede FTPS esplicito (verificato 2026-08-13: plain FTP viene
    // rifiutato dal server; il certificato valida senza dover disabilitare
    // la verifica, a differenza di alcuni altri host legacy Hetzner usati in
    // questo progetto).
    await client.access({ host, user, password, secure: true });

    if (!dryRun) {
      for (const dir of [processedDir, errorsDir]) {
        try {
          await client.ensureDir(dir);
        } catch { /* già esistente, o la creazione fallisce e lo scopriamo comunque sotto */ }
      }
      await client.cd("/");
    }

    const rootList = await client.list("/");
    const inboxFiles = rootList.filter((f) => f.isFile && f.name.toLowerCase().endsWith(".xml"));
    let filesToProcess = inboxFiles.map((f) => ({ file: f, src: `/${f.name}`, dest: `${processedDir}/${f.name}` }));

    if (force) {
      const processedList = await client.list(processedDir).catch(() => []);
      const processedFiles = processedList
        .filter((f) => f.isFile && f.name.toLowerCase().endsWith(".xml"))
        .map((f) => ({ file: f, src: `${processedDir}/${f.name}`, dest: `${processedDir}/${f.name}` }));
      filesToProcess = [...filesToProcess, ...processedFiles];
    }

    const now = Date.now();

    for (const { file, src, dest } of filesToProcess) {
      try {
        const { writable, getBuffer } = collectToBuffer();
        await client.downloadTo(writable, src);
        const xmlContent = getBuffer().toString("utf8");
        const { orderDocId, skipped } = await processXmlOrder(db, xmlContent, file.name, dryRun);

        if (!dryRun && src !== dest) await client.rename(src, dest);

        result.processedCount++;
        if (skipped) result.skippedCount++;
        else result.newCount++;
        void orderDocId;
      } catch (err) {
        result.errors.push({ id: file.name, message: err instanceof Error ? err.message : String(err) });

        const age = file.modifiedAt ? now - file.modifiedAt.getTime() : 0;
        if (!dryRun && age > QUARANTINE_AFTER_MS) {
          try {
            await client.rename(src, `${errorsDir}/${file.name}`);
            result.quarantinedCount++;
          } catch { /* se anche lo spostamento fallisce, resta in root e si ritenta */ }
        }
        // Altrimenti il file resta in root → ritentato al prossimo run.
      }
    }
  } finally {
    client.close();
  }

  return result;
}

/* ── entry point ─────────────────────────────────────────────────── */

/**
 * @param {{ force?: boolean, dryRun?: boolean }} [opts]
 */
export async function runTyreworldImport(opts = {}) {
  const { force = false, dryRun = false } = opts;
  const db = adminDb();
  return runFtpImport(db, dryRun, force);
}
