// Invio email ordine B2B (checkout self-service, "ordina per conto di" e
// converti-preventivo) — port del template della Cloud Function
// `Order_Email_OnCreation` (repo SpieziaFunctions/SendEmail, progetto
// Firebase crm-3iuocs), SENZA il ramo "modalità appuntamento"
// (Data_Prenotazione/Sede_Appuntamento) — mai richiesto per questo flusso,
// resta gestito solo dalla vecchia Cloud Function finché non viene spenta.
//
// SMTP mail.your-server.de:587 (non secure, TLS non verificato) — stesso
// host di lib/emailAdmin/sendReply.js ma account/porta dedicati
// (b2b@spieziatyres.it), identici a quelli della Cloud Function originale.
//
// Immagine prodotto OMESSA dal template: il checkout nativo Postgres
// (app/api/checkout/ordine/route.ts) non cattura mai un URL immagine per
// riga articolo — la Cloud Function la leggeva da un campo Firestore
// (Articoli[].Immagine) che questo flusso non popola. Nessun dato da
// mostrare, non una regressione.
//
// Fire-and-forget per design: un fallimento di invio non deve mai far
// fallire una richiesta di creazione ordine già andata a buon fine —
// i chiamanti devono usare `.catch(...)`, mai `await` bloccante sulla
// response (stesso principio di saveAddressIfNewCliente/saveAddressIfNewPg
// in app/api/checkout/ordine/route.ts).

import nodemailer from "nodemailer";
import { getDb } from "@/lib/db";
import { getOrdine, type OrdineApi } from "@/lib/ordiniDb";
import type { Indirizzo } from "@/lib/types";

const SMTP_HOST = "mail.your-server.de";
const SMTP_PORT = 587;
const SMTP_USER = "b2b@spieziatyres.it";
const EMAIL_FROM = '"Spiezia Tyres" <b2b@spieziatyres.it>';
const EMAIL_CC = process.env.ORDINI_EMAIL_CC || "Spieziatyresb2b@gmail.com";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#039;";
      default: return m;
    }
  });
}

// Stesso pattern/nome campo di lib/rappresentanteDb.ts e
// checkAndDecrementFido (lib/clientiDb.ts): il collegamento
// cliente/utente→rappresentante vive in fs_extra->>'Rappresentante', mai una
// colonna dedicata. Tabella scelta con la stessa precedenza di
// rowToClienteInfo in lib/ordiniDb.ts (ClienteId se l'ordine è "per conto
// di", altrimenti UtenteId per il self-service).
async function resolveRappresentanteEmail(ordine: OrdineApi): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const table = ordine.ClienteId ? "clienti" : "utenti";
  const id = ordine.ClienteId ?? ordine.UtenteId;
  if (!id) return null;
  const { rows } = await db.query(
    `SELECT fs_extra->>'Rappresentante' AS rappresentante FROM core.${table} WHERE id = $1`,
    [id]
  );
  return (rows[0]?.rappresentante as string) || null;
}

function formatAddress(a: Indirizzo | null): string {
  if (!a) return "";
  const destinatario = [a.Nome, a.Cognome].filter(Boolean).join(" ");
  const via = [a.Via, a.Civico].filter(Boolean).join(" ");
  return [destinatario, via, a.Citta, a.CAP, a.Provincia, a.Telefono]
    .filter((v): v is string => !!v)
    .map((v) => escapeHtml(v))
    .join("<br>");
}

function buildProductRows(ordine: OrdineApi): string {
  return ordine.Articoli.map((a) => {
    const titolo = escapeHtml([a.Marca, a.Titolo].filter(Boolean).join(" ") || "Articolo");
    const prezzoTotale = (a.PrezzoTotale ?? (a.PrezzoUnitario ?? 0) * a.Quantita).toFixed(2);
    return `
              <div style="padding:8px 24px">
                <table align="center" width="100%" cellpadding="0" border="0" style="table-layout:fixed;border-collapse:collapse">
                  <tbody>
                    <tr>
                      <td style="vertical-align:middle;padding:0 5.3333px;width:250px">
                        <div style="font-size:12px;padding:0 24px 8px 0">${titolo}</div>
                        <div style="font-size:12px;padding:0 24px 0 0">Quantità: ${a.Quantita} | SKU: ${escapeHtml(a.Sku ?? "")}</div>
                      </td>
                      <td style="vertical-align:middle;padding-left:10.6667px">
                        <div style="font-size:14px;text-align:right;padding:16px 24px">${prezzoTotale} €</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>`;
  }).join("");
}

function buildOrdineEmailHtml(ordine: OrdineApi, customMessage: string): string {
  const fatturazioneStr = formatAddress(ordine.IndirizzoFatturazione);
  const spedizioneStr = formatAddress(ordine.IndirizzoSpedizione);
  const dataStr = ordine.Data
    ? new Date(ordine.Data).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })
    : "";

  return `<!doctype html>
<html>
  <body>
    <div style='background-color:#F5F5F5;color:#262626;font-family:"Helvetica Neue","Arial Nova","Nimbus Sans",Arial,sans-serif;font-size:16px;font-weight:400;letter-spacing:0.15008px;line-height:1.5;margin:0;padding:32px 0;min-height:100%;width:100%'>
      <table align="center" width="100%" style="margin:0 auto;max-width:600px;background-color:#FFFFFF" role="presentation" cellspacing="0" cellpadding="0" border="0">
        <tbody>
          <tr style="width:100%">
            <td>
              <div style="background-color:#F9F9F9;padding:0">
                <div style="padding:16px 24px;text-align:center">
                  <img alt="Spiezia Tyres S.p.a" src="https://b2b.spieziatyres.it/wp-content/uploads/2024/10/SpieziaTyresSPA-Yellow.pdf.png" width="150" style="width:150px;outline:none;border:none;text-decoration:none;vertical-align:middle;display:inline-block;max-width:100%" />
                </div>
              </div>
              <div style="background-color:#F9F9F9;padding:8px 24px">
                <div style="font-size:14px;text-align:center;padding:16px 24px">${customMessage}</div>
                <div style="font-size:14px;text-align:center;padding:0 24px 16px 24px">
                  Numero Ordine #${escapeHtml(ordine.Numero ?? "")} - Totale ${ordine.Totale.toFixed(2)} € - ${escapeHtml(dataStr)}
                </div>
              </div>
              <div style="padding:16px 24px">
                <table align="center" width="100%" cellpadding="0" border="0" style="table-layout:fixed;border-collapse:collapse">
                  <tbody>
                    <tr>
                      <td style="vertical-align:top;padding-right:8px">
                        <div style="font-size:14px;text-align:center;padding:16px 24px">Fatturazione</div>
                        <div style="font-size:12px;text-align:center;padding:16px 24px">${fatturazioneStr}</div>
                      </td>
                      <td style="vertical-align:top;padding-left:8px">
                        <div style="font-size:14px;text-align:center;padding:16px 24px">Spedizione</div>
                        <div style="font-size:12px;text-align:center;padding:16px 24px">${spedizioneStr}</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style="padding:16px 24px">
                <div style="font-size:15px;padding:16px 24px">Riepilogo:</div>
              </div>
              ${buildProductRows(ordine)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </body>
</html>`;
}

/** No-op silenzioso se l'ordine non esiste più, non è B2B, o non risulta
 *  nessun destinatario valido (cliente senza email + nessun rappresentante,
 *  caso limite ma possibile per anagrafiche incomplete). */
export async function sendOrdineEmail(ordineId: string): Promise<void> {
  const password = process.env.ORDINI_SMTP_PASSWORD;
  if (!password) {
    console.error("[ordineEmail] ORDINI_SMTP_PASSWORD mancante — invio saltato");
    return;
  }

  const ordine = await getOrdine(ordineId);
  if (!ordine || ordine.Source !== "B2B") return;

  const customerEmail = ordine.ClienteInfo?.email ?? null;
  const customerName = ordine.ClienteInfo?.nome ?? "Cliente";
  const rappresentanteEmail = await resolveRappresentanteEmail(ordine);

  const recipients = Array.from(
    new Set(
      [customerEmail, EMAIL_CC, rappresentanteEmail].filter(
        (e): e is string => !!e && e.includes("@")
      )
    )
  );
  if (recipients.length === 0) return;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: { user: SMTP_USER, pass: password },
    tls: { rejectUnauthorized: false },
  });

  const results = await Promise.allSettled(
    recipients.map((email) => {
      const isCustomer = email === customerEmail;
      const customMessage = isCustomer
        ? "Grazie per il tuo Ordine!"
        : `${escapeHtml(customerName)} ha effettuato un ordine.`;
      return transporter.sendMail({
        from: EMAIL_FROM,
        to: email,
        subject: `Nuovo Ordine B2B #${ordine.Numero ?? ""}`,
        html: buildOrdineEmailHtml(ordine, customMessage),
      });
    })
  );

  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`[ordineEmail] invio fallito a ${recipients[i]}:`, r.reason);
    }
  });
}
