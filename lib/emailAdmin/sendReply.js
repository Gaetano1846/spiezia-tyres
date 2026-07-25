// Invio risposta email (Fase 9-quater C) — port 1:1 della Cloud Function
// `send_email_reply` (crm-3iuocs, us-central1), sorgente reale riscaricato
// da GCP. Invio SMTP via nodemailer (mail.your-server.de, utente
// hub@spieziatyres.it) con supporto reply-to/cc/bcc/allegati.
//
// Porta 587 (non 465, come nel sorgente CF originale): verificato che dal
// container di produzione la 465 va sempre in timeout in uscita (bloccata),
// mentre la 587 sullo stesso host risponde istantaneamente — stessa porta
// già usata con successo da lib/email/ordineEmail.ts verso lo stesso host.
//
// Differenza dal sorgente CF originale: IMAP_PASSWORD letta da process.env
// (prima Secret Manager via defineSecret) — stesso pattern di tutti gli
// altri secret in questa app.

import nodemailer from "nodemailer";

/**
 * @param {{ to: string, subject?: string, html?: string, htmlBody?: string, replyToMessageId?: string, cc?: string, bcc?: string, attachments?: any[] }} params
 */
export async function sendEmailReply({ to, subject, html, htmlBody, replyToMessageId, cc, bcc, attachments }) {
  const finalHtml = html || htmlBody;
  if (!to || !finalHtml) throw new Error("Campi obbligatori mancanti: 'to' o 'html'");

  const password = process.env.IMAP_PASSWORD;
  if (!password) throw new Error("IMAP_PASSWORD mancante");

  const transporter = nodemailer.createTransport({
    host: "mail.your-server.de",
    port: 587,
    secure: false,
    tls: { rejectUnauthorized: false },
    auth: { user: "hub@spieziatyres.it", pass: password },
  });

  const mailOptions = {
    from: '"Spiezia Tyres Hub" <hub@spieziatyres.it>',
    to,
    subject: subject || "Re: Risposta da Spiezia Tyres",
    html: finalHtml,
  };

  if (replyToMessageId) {
    mailOptions.inReplyTo = replyToMessageId;
    mailOptions.references = [replyToMessageId];
  }
  if (cc) mailOptions.cc = cc;
  if (bcc) mailOptions.bcc = bcc;
  if (Array.isArray(attachments) && attachments.length > 0) mailOptions.attachments = attachments;

  const info = await transporter.sendMail(mailOptions);
  return { messageId: info.messageId, response: info.response };
}
