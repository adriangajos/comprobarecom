/**
 * Comprobare — license order endpoint.
 *
 * On POST it:
 *   1. validates the order,
 *   2. recomputes the totals server-side (never trusts the client amounts),
 *   3. allocates a sequential proforma number,
 *   4. generates a proforma-invoice PDF,
 *   5. emails it to the buyer (and notifies the seller),
 *   6. stores the order in Firestore,
 *   7. returns { ok: true, proformaNumber }.
 *
 * The license key is NOT issued here — it is sent manually/automatically once
 * the payment is confirmed on the bank account.
 */

import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import { fileURLToPath } from "url";
import {
  payuBaseUrl,
  getAccessToken,
  createPayuOrder as payuCreateOrder,
  verifyNotificationSignature,
} from "./payu.js";
import { createLicensesInTx } from "./license.js";

initializeApp();
const db = getFirestore();

// Unicode fonts (Polish characters) bundled in functions/fonts/.
const FONT_REGULAR = fileURLToPath(new URL("./fonts/DejaVuSans.ttf", import.meta.url));
const FONT_BOLD = fileURLToPath(new URL("./fonts/DejaVuSans-Bold.ttf", import.meta.url));

setGlobalOptions({ region: "europe-central2", maxInstances: 5 });

// ── SMTP (Gmail) — only the password is secret. ─────────────────────────────
// SMTP_PASS must be a Gmail App Password (16 chars; requires 2-Step Verification
// on comprobareapp@gmail.com). Set it with: firebase functions:secrets:set SMTP_PASS
const SMTP_PASS = defineSecret("SMTP_PASS");
const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465; // SSL
const SMTP_USER = "comprobareapp@gmail.com";

// ── PayU (EUR shop "eur", REST API / Checkout) ──────────────────────────────
// Secrets set via: firebase functions:secrets:set PAYU_POS_ID / PAYU_CLIENT_ID
// / PAYU_CLIENT_SECRET / PAYU_SECOND_KEY. NEVER hardcode these — this repo is
// published to GitHub Pages.
const PAYU_POS_ID = defineSecret("PAYU_POS_ID");
const PAYU_CLIENT_ID = defineSecret("PAYU_CLIENT_ID");
const PAYU_CLIENT_SECRET = defineSecret("PAYU_CLIENT_SECRET");
const PAYU_SECOND_KEY = defineSecret("PAYU_SECOND_KEY");
// "sandbox" → secure.snd.payu.com, "production" → secure.payu.com.
const PAYU_ENV = "production";
// The production shop is EUR. The sandbox shop is PLN-locked (the "Dodaj sklep"
// form forces PLN), so we test in PLN there — currency is irrelevant to the
// license/webhook logic. Production keeps EUR (= CURRENCY, declared below;
// kept as a literal here to avoid a temporal-dead-zone reference).
const PAYU_CURRENCY = PAYU_ENV === "sandbox" ? "PLN" : "EUR";
// Deployed function base (region europe-central2, project comprobare-ce8a1).
const FN_BASE = "https://europe-central2-comprobare-ce8a1.cloudfunctions.net";
// Where PayU sends the buyer back after the payment screen. The real
// confirmation comes from the async notification, not this redirect.
const CONTINUE_URL = "https://comprobare.com/order.html?payu=return";

// ── Seller / invoice configuration — EDIT THESE ─────────────────────────────
const SELLER = {
  name: "GS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
  address: ["ul. Płaszowska 25/1", "30-713 Kraków", "Poland"],
  nip: "6793317716",
  krs: "0001144358",
  regon: "540426181",
  email: "comprobareapp@gmail.com",
  // EUR bank account for the proforma.
  bank: {
    accountHolder: "GS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
    bankName: "ING Bank Śląski S.A.",
    iban: "PL45 1050 1445 1000 0090 8706 5935",
    swift: "INGBPLPW",
  },
  // Where seller notifications/copies are sent.
  notifyEmail: "comprobareapp@gmail.com",
  // "From" address used on outgoing mail. Must be allowed by your SMTP account.
  mailFrom: "Comprobare <comprobareapp@gmail.com>",
};

const PRODUCT_NAME = "Comprobare license — 1 station / 1 year";
const UNIT_GROSS = 100; // EUR, incl. VAT
const VAT_RATE = 0.23;
// License plan: each ordered unit = 1 station for 1 year (1 device). 0 = perpetual.
const LICENSE_DURATION_DAYS = 365;
const MAX_DEVICES_PER_LICENSE = 1;
const CURRENCY = "EUR";
const PROFORMA_VALID_DAYS = 7;
// Numbering starts after this value, so the first issued proforma is 101.
const PROFORMA_START = 100;

// Public order endpoint — allow any origin (CORS is not a meaningful control
// here since the endpoint can be called server-side regardless; abuse is
// handled by validation + maxInstances). This also lets the page be tested
// locally (file:// sends origin "null").
const CORS = true;

// ── helpers ─────────────────────────────────────────────────────────────────
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const eur = (n) => `${round2(n).toFixed(2)} ${CURRENCY}`;

// Server-side totals (gross = €100/license incl. VAT). Never trust client amounts.
function computeTotals(qty) {
  const gross = round2(UNIT_GROSS * qty);
  const net = round2(gross / (1 + VAT_RATE));
  const vat = round2(gross - net);
  return { qty, net, vat, gross };
}

function sanitize(s, max = 500) {
  // Strip control characters but keep newlines (the address may span lines).
  const str = String(s == null ? "" : s);
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 10 || code >= 32) out += str[i];
  }
  return out.trim().slice(0, max);
}

function validate(body) {
  const errors = [];
  let qty = parseInt(body.quantity, 10);
  if (isNaN(qty) || qty < 1) errors.push("quantity");
  if (qty > 999) qty = 999;

  const name = sanitize(body.name, 200);
  const address = sanitize(body.address, 500);
  const vatNumber = sanitize(body.vatNumber, 60);
  const email = sanitize(body.email, 160);
  const phone = sanitize(body.phone, 60);
  const lang = body.lang === "pl" ? "pl" : "en";

  if (!name) errors.push("name");
  if (!address) errors.push("address");
  if (!vatNumber) errors.push("vatNumber");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("email");
  if (!phone) errors.push("phone");

  return { errors, data: { qty, name, address, vatNumber, email, phone, lang } };
}

async function nextProformaNumber() {
  const year = new Date().getFullYear();
  const ref = db.collection("counters").doc("proforma");
  const seq = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let current = PROFORMA_START;
    if (snap.exists && snap.get("year") === year) {
      current = Math.max(snap.get("seq") || 0, PROFORMA_START);
    }
    const next = current + 1;
    tx.set(ref, { year, seq: next }, { merge: true });
    return next;
  });
  return `PF/${year}/${String(seq).padStart(3, "0")}`;
}

// Draw the Comprobare logo mark (from the 80x80 SVG symbol) at (x, y), scaled.
function drawLogoMark(doc, x, y, size) {
  const s = size / 80;
  doc.save();
  doc.translate(x, y).scale(s);
  doc.lineCap("round");
  doc.lineWidth(8.5).strokeColor("#0078d4").path("M 58 14 A 28 28 0 1 0 58 66").stroke();
  doc.lineWidth(3.5).strokeColor("#0078d4").moveTo(49, 14).lineTo(67, 14).stroke();
  doc.lineWidth(3.5).strokeColor("#0078d4").moveTo(49, 66).lineTo(67, 66).stroke();
  doc.lineWidth(2).strokeColor("#4fc3f7").dash(5, { space: 3.5 }).moveTo(72, 15).lineTo(72, 65).stroke().undash();
  doc.lineWidth(2).strokeColor("#4fc3f7").moveTo(68, 14).lineTo(76, 14).stroke();
  doc.lineWidth(2).strokeColor("#4fc3f7").moveTo(68, 66).lineTo(76, 66).stroke();
  doc.restore();
}

// `paid` = true renders the post-payment variant (online/PayU, marked PAID,
// VAT invoice to follow). Default false keeps the original bank-transfer proforma.
export function buildProformaPdf({ proformaNumber, order, totals, dates, paid = false }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Unicode fonts so Polish characters render correctly.
    doc.registerFont("Body", FONT_REGULAR);
    doc.registerFont("Bold", FONT_BOLD);

    const BLUE = "#0078d4";
    const GREY = "#5a5f66";
    const DARK = "#1a1c1f";
    const left = 50;
    const right = 545;

    // Header — logo mark + wordmark on the left, invoice title on the right
    drawLogoMark(doc, left, 46, 26);
    doc.fontSize(20).font("Body").fillColor(DARK).text("com", left + 34, 50, { continued: true });
    doc.font("Bold").fillColor(BLUE).text("pro", { continued: true });
    doc.font("Body").fillColor(DARK).text("bare");

    doc.fillColor(DARK).fontSize(18).font("Bold")
      .text("PROFORMA INVOICE", left, 50, { width: right - left, align: "right" });
    doc.fillColor(GREY).fontSize(10).font("Body")
      .text(`No. ${proformaNumber}`, left, 74, { width: right - left, align: "right" })
      .text(`Issue date: ${dates.issue}`, { width: right - left, align: "right" })
      .text(paid ? `Paid on: ${dates.issue}` : `Pay by: ${dates.due}`, { width: right - left, align: "right" });

    doc.moveTo(left, 110).lineTo(right, 110).lineWidth(1).strokeColor("#e0e3e7").stroke();

    // Seller / Buyer
    const colTop = 128;
    doc.fillColor(GREY).fontSize(9).font("Bold").text("SELLER", left, colTop);
    doc.fillColor(DARK).fontSize(10).font("Body");
    doc.text(SELLER.name, left, colTop + 14, { width: 240 });
    SELLER.address.forEach((l) => doc.text(l, { width: 240 }));
    doc.text(`NIP: ${SELLER.nip}`).text(`KRS: ${SELLER.krs} · REGON: ${SELLER.regon}`).text(SELLER.email);

    const bx = 320;
    doc.fillColor(GREY).fontSize(9).font("Bold").text("BILL TO", bx, colTop);
    doc.fillColor(DARK).fontSize(10).font("Body");
    doc.text(order.name, bx, colTop + 14, { width: 225 });
    order.address.split(/\r?\n/).forEach((l) => l.trim() && doc.text(l.trim(), { width: 225 }));
    doc.text(`VAT/NIP: ${order.vatNumber}`, { width: 225 });
    doc.text(order.email, { width: 225 });
    if (order.phone) doc.text(order.phone, { width: 225 });

    // Line items table
    let y = 280;
    doc.rect(left, y, right - left, 22).fill(BLUE);
    doc.fillColor("#ffffff").fontSize(9).font("Bold");
    doc.text("DESCRIPTION", left + 10, y + 7);
    doc.text("QTY", left + 285, y + 7, { width: 40, align: "right" });
    doc.text("NET", left + 330, y + 7, { width: 70, align: "right" });
    doc.text("VAT", left + 400, y + 7, { width: 35, align: "right" });
    doc.text("GROSS", left + 425, y + 7, { width: 70, align: "right" });

    y += 22;
    doc.fillColor(DARK).fontSize(10).font("Body");
    doc.text(PRODUCT_NAME, left + 10, y + 8, { width: 265 });
    doc.text(String(totals.qty), left + 285, y + 8, { width: 40, align: "right" });
    doc.text(eur(totals.net), left + 330, y + 8, { width: 70, align: "right" });
    doc.text("23%", left + 400, y + 8, { width: 35, align: "right" });
    doc.text(eur(totals.gross), left + 425, y + 8, { width: 70, align: "right" });
    doc.moveTo(left, y + 28).lineTo(right, y + 28).lineWidth(1).strokeColor("#e0e3e7").stroke();

    // Totals
    y += 44;
    const tl = 360;
    doc.fontSize(10).font("Body").fillColor(GREY);
    doc.text("Net total", tl, y, { width: 90, align: "right" });
    doc.fillColor(DARK).text(eur(totals.net), tl + 95, y, { width: 90, align: "right" });
    doc.fillColor(GREY).text("VAT (23%)", tl, y + 16, { width: 90, align: "right" });
    doc.fillColor(DARK).text(eur(totals.vat), tl + 95, y + 16, { width: 90, align: "right" });
    const boxX = 300, boxW = 245; // right edge 545, aligned with the columns above
    doc.rect(boxX, y + 34, boxW, 30).fill("#eef4fb");
    doc.fillColor(BLUE).fontSize(12).font("Bold");
    doc.text("TOTAL TO PAY:", boxX + 16, y + 44, { width: 140, align: "left" });
    doc.text(eur(totals.gross), boxX + 16, y + 44, { width: boxW - 32, align: "right" });

    // Payment details
    y += 92;
    doc.fillColor(GREY).fontSize(9).font("Bold").text("PAYMENT DETAILS", left, y);
    doc.fillColor(DARK).fontSize(10).font("Body");
    if (paid) {
      doc.text("Method: online payment (PayU)", left, y + 14);
      doc.text("Status: PAID — thank you");
      doc.text(`Reference: ${proformaNumber}`);
    } else {
      doc.text("Method: bank transfer", left, y + 14);
      doc.text(`Account holder: ${SELLER.bank.accountHolder}`);
      doc.text(`Bank: ${SELLER.bank.bankName}`);
      doc.text(`IBAN: ${SELLER.bank.iban}`);
      doc.text(`SWIFT/BIC: ${SELLER.bank.swift}`);
      doc.text(`Payment reference: ${proformaNumber}`);
    }

    // Note
    y = doc.y + 18;
    doc.rect(left, y, right - left, 60).fill("#f4f7fb");
    doc.fillColor(DARK).fontSize(9.5).font("Body")
      .text(
        paid
          ? "This is a proforma invoice. We have received your payment in full — thank you. The " +
            "license key(s) needed to activate the application are included in our email. A VAT " +
            "invoice will be generated by our accounting system and emailed to you shortly."
          : "This is a proforma invoice, not a VAT invoice. After we receive your payment on the bank " +
            "account above, we will email you the license key(s) needed to activate the application. " +
            "A VAT invoice is issued after the payment is credited.",
        left + 10, y + 10, { width: right - left - 20 }
      );

    doc.fillColor(GREY).fontSize(8).font("Body")
      .text(`${SELLER.name} · ${SELLER.email}`, left, 780, { width: right - left, align: "center" });

    doc.end();
  });
}

// Email signature: comprobare wordmark + company details.
function htmlSignature() {
  return (
    `<div style="margin-top:28px;border-top:1px solid #e0e3e7;padding-top:16px;` +
    `font-family:Arial,Helvetica,sans-serif;color:#5a5f66;font-size:12px;line-height:1.6">` +
    `<div style="font-size:22px;font-weight:300;color:#1a1c1f;letter-spacing:-0.5px">` +
    `com<span style="font-weight:700;color:#0078d4">pro</span>bare</div>` +
    `<div style="margin-top:6px">${SELLER.name}<br>` +
    `${SELLER.address.join(", ")}<br>` +
    `NIP ${SELLER.nip} · KRS ${SELLER.krs} · REGON ${SELLER.regon}<br>` +
    `<a href="mailto:${SELLER.email}" style="color:#0078d4">${SELLER.email}</a></div></div>`
  );
}
function textSignature() {
  return (
    `\n\n—\ncomprobare\n${SELLER.name}\n${SELLER.address.join(", ")}\n` +
    `NIP ${SELLER.nip} · KRS ${SELLER.krs} · REGON ${SELLER.regon}\n${SELLER.email}`
  );
}

function emailBodies(lang, { proformaNumber, totals, dates }) {
  if (lang === "pl") {
    return {
      subject: `Faktura proforma ${proformaNumber} — Comprobare`,
      text:
        `Dzień dobry,\n\nDziękujemy za zamówienie. W załączeniu faktura proforma ${proformaNumber}.\n\n` +
        `Licencje: ${totals.qty}\nDo zapłaty: ${eur(totals.gross)} (w tym VAT ${eur(totals.vat)})\n` +
        `Termin płatności: ${dates.due}\nTytuł przelewu: ${proformaNumber}\n\n` +
        `Po zaksięgowaniu wpłaty na naszym koncie wyślemy na ten adres e-mail klucz(e) ` +
        `licencyjny potrzebny do aktywacji aplikacji.\n\nPozdrawiamy,` +
        textSignature(),
      html:
        `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1c1f;font-size:14px;line-height:1.6">` +
        `<p>Dzień dobry,</p><p>Dziękujemy za zamówienie. W załączeniu faktura proforma <b>${proformaNumber}</b>.</p>` +
        `<p>Licencje: <b>${totals.qty}</b><br>Do zapłaty: <b>${eur(totals.gross)}</b> (w tym VAT ${eur(totals.vat)})<br>` +
        `Termin płatności: <b>${dates.due}</b><br>Tytuł przelewu: <b>${proformaNumber}</b></p>` +
        `<p><b>Po otrzymaniu wpłaty na nasze konto</b> wyślemy na ten adres e-mail klucz(e) ` +
        `licencyjny potrzebny do aktywacji aplikacji.</p><p>Pozdrawiamy,</p>` +
        htmlSignature() + `</div>`,
    };
  }
  return {
    subject: `Proforma invoice ${proformaNumber} — Comprobare`,
    text:
      `Hello,\n\nThank you for your order. Your proforma invoice ${proformaNumber} is attached.\n\n` +
      `Licenses: ${totals.qty}\nAmount due: ${eur(totals.gross)} (incl. VAT ${eur(totals.vat)})\n` +
      `Pay by: ${dates.due}\nPayment reference: ${proformaNumber}\n\n` +
      `Once we receive your payment on our bank account, we will email you the license key(s) ` +
      `needed to activate the application.\n\nBest regards,` +
      textSignature(),
    html:
      `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1c1f;font-size:14px;line-height:1.6">` +
      `<p>Hello,</p><p>Thank you for your order. Your proforma invoice <b>${proformaNumber}</b> is attached.</p>` +
      `<p>Licenses: <b>${totals.qty}</b><br>Amount due: <b>${eur(totals.gross)}</b> (incl. VAT ${eur(totals.vat)})<br>` +
      `Pay by: <b>${dates.due}</b><br>Payment reference: <b>${proformaNumber}</b></p>` +
      `<p><b>Once we receive your payment on our bank account</b>, we will email you the license ` +
      `key(s) needed to activate the application.</p><p>Best regards,</p>` +
      htmlSignature() + `</div>`,
  };
}

// Payment-confirmation email (always English, like the proforma).
// `licenseKeys` is an array of key strings when auto-issued, else null.
function paidEmailBodies({ orderNumber, totals, licenseKeys }) {
  const keysBlockHtml = licenseKeys && licenseKeys.length
    ? `<p>Your license key${licenseKeys.length > 1 ? "s" : ""}:</p>` +
      `<p style="font-family:Consolas,monospace;font-size:15px;color:#0078d4">` +
      licenseKeys.map((k) => `<b>${k}</b>`).join("<br>") + `</p>`
    : `<p>Your license key(s) will arrive in a separate email shortly.</p>`;
  const keysBlockText = licenseKeys && licenseKeys.length
    ? `\nYour license key(s):\n${licenseKeys.join("\n")}\n`
    : `\nYour license key(s) will arrive in a separate email shortly.\n`;
  return {
    subject: `Payment received ${orderNumber} — Comprobare`,
    text:
      `Hello,\n\nThank you — your payment has been received in full.\n\n` +
      `Order: ${orderNumber}\nLicenses: ${totals.qty}\n` +
      `Paid: ${eur(totals.gross)} (incl. VAT ${eur(totals.vat)})\n` +
      keysBlockText +
      `\nA proforma invoice is attached. Your VAT invoice will be generated by our system ` +
      `and emailed to you shortly.\n\nBest regards,` +
      textSignature(),
    html:
      `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1c1f;font-size:14px;line-height:1.6">` +
      `<p>Hello,</p><p>Thank you — your payment has been received in full.</p>` +
      `<p>Order: <b>${orderNumber}</b><br>Licenses: <b>${totals.qty}</b><br>` +
      `Paid: <b>${eur(totals.gross)}</b> (incl. VAT ${eur(totals.vat)})</p>` +
      keysBlockHtml +
      `<p>A proforma invoice is attached. Your VAT invoice will be generated by our system ` +
      `and emailed to you shortly.</p><p>Best regards,</p>` +
      htmlSignature() + `</div>`,
  };
}

function makeTransporter() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS.value() },
  });
}

// TODO(phase 3): issue a VAT invoice via the SaldeoSmart REST API and return
// { number, pdf } (pdf as a Buffer to attach), or null if not configured yet.
async function issueSaldeoInvoice(/* order, totals, orderNumber */) {
  return null;
}

/**
 * Mark a PAID order processed and mint its license keys — ATOMICALLY.
 * Keys are created inside the transaction together with the order's `paid`
 * flag, so PayU notification retries can never produce duplicate keys.
 * Returns { keys, justCreated }; on a retry of an already-processed order it
 * returns the existing keys with justCreated=false.
 */
async function markPaidAndIssueKeys(docRef, payuOrderId) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef); // read first
    if (!snap.exists) throw new Error("order_not_found");
    if (snap.get("keysIssued")) {
      return { keys: snap.get("licenseKeys") || [], justCreated: false };
    }

    const qty = parseInt(snap.get("qty"), 10) || 1;
    const keys = await createLicensesInTx(db, tx, {
      count: qty,
      email: snap.get("email"),
      planDays: LICENSE_DURATION_DAYS,
      orderId: payuOrderId || snap.id,
      maxDevices: MAX_DEVICES_PER_LICENSE,
    });

    tx.set(
      docRef,
      {
        status: "paid",
        paidAt: FieldValue.serverTimestamp(),
        payuOrderId: payuOrderId || null,
        licenseKeys: keys,
        keysIssued: true,
      },
      { merge: true }
    );
    return { keys, justCreated: true };
  });
}

/**
 * Post-payment side effects (run AFTER the transaction commits): issue the VAT
 * invoice and email the buyer their keys + invoice, BCC the seller. Guarded by
 * a `confirmedAt` flag so PayU retries don't re-send. Best-effort — failures
 * are logged and will be retried on the next notification (keys already exist).
 */
async function sendFulfilment(docRef, order, totals, orderNumber, licenseKeys) {
  let invoice = null;
  try {
    invoice = await issueSaldeoInvoice(order, totals, orderNumber);
  } catch (e) {
    logger.error("payu.saldeoInvoice.failed", { orderNumber, err: String(e) });
  }

  // Always attach a proforma (marked PAID). The proper VAT invoice follows from
  // SaldeoSmart once that's wired; until then the buyer/seller get the proforma.
  const safeName = orderNumber.replace(/\//g, "_");
  const attachments = [];
  try {
    const dates = { issue: new Date().toISOString().slice(0, 10) };
    const proformaPdf = await buildProformaPdf({ proformaNumber: orderNumber, order, totals, dates, paid: true });
    attachments.push({ filename: `proforma-${safeName}.pdf`, content: proformaPdf });
  } catch (e) {
    logger.error("payu.proformaPdf.failed", { orderNumber, err: String(e) });
  }
  if (invoice?.pdf) attachments.push({ filename: `invoice-${safeName}.pdf`, content: invoice.pdf });

  const bodies = paidEmailBodies({ orderNumber, totals, licenseKeys });
  const transporter = makeTransporter();

  // Customer-facing email (to buyer, BCC seller for their records). Kept clean —
  // no internal notes leak here.
  await transporter.sendMail({
    from: SELLER.mailFrom,
    to: order.email,
    bcc: SELLER.notifyEmail,
    replyTo: SELLER.email,
    subject: bodies.subject,
    text: bodies.text,
    html: bodies.html,
    attachments,
  });

  // Separate internal reminder to the seller only, while SaldeoSmart isn't wired.
  if (!invoice) {
    try {
      await transporter.sendMail({
        from: SELLER.mailFrom,
        to: SELLER.notifyEmail,
        subject: `[ACTION] Issue VAT invoice — ${orderNumber}`,
        text:
          `Paid order needs a VAT invoice issued manually (SaldeoSmart not wired yet).\n\n` +
          `Order: ${orderNumber}\nAmount: ${eur(totals.gross)} (net ${eur(totals.net)}, VAT ${eur(totals.vat)})\n` +
          `Licenses: ${totals.qty}\n\n` +
          `Buyer: ${order.name}\nVAT/NIP: ${order.vatNumber}\n` +
          `Address: ${String(order.address).replace(/\r?\n/g, ", ")}\n` +
          `Email: ${order.email}\nPhone: ${order.phone || "-"}\n`,
      });
    } catch (e) {
      logger.error("payu.sellerReminder.failed", { orderNumber, err: String(e) });
    }
  }

  await docRef.set(
    { confirmedAt: FieldValue.serverTimestamp(), invoiceNumber: invoice?.number || null, invoiceIssued: !!invoice },
    { merge: true }
  );
}

// ── HTTP endpoint ────────────────────────────────────────────────────────────
export const createOrder = onRequest(
  { secrets: [SMTP_PASS], cors: CORS },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "method_not_allowed" });
      return;
    }

    try {
      const { errors, data } = validate(req.body || {});
      if (errors.length) {
        res.status(400).json({ ok: false, error: "invalid_input", fields: errors });
        return;
      }

      const totals = computeTotals(data.qty);
      const { gross } = totals;

      const now = new Date();
      const due = new Date(now.getTime() + PROFORMA_VALID_DAYS * 86400000);
      const fmtDate = (d) => d.toISOString().slice(0, 10);
      const dates = { issue: fmtDate(now), due: fmtDate(due) };

      const proformaNumber = await nextProformaNumber();
      const order = data;

      const pdf = await buildProformaPdf({ proformaNumber, order, totals, dates });

      // Send email (Gmail SMTP)
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS.value() },
      });

      // Invoices/emails are always issued in English.
      const bodies = emailBodies("en", { proformaNumber, totals, dates });
      const attachments = [{ filename: `${proformaNumber.replace(/\//g, "_")}.pdf`, content: pdf }];

      // One email: the proforma to the buyer, with a hidden BCC copy to the seller.
      await transporter.sendMail({
        from: SELLER.mailFrom,
        to: data.email,
        bcc: SELLER.notifyEmail,
        replyTo: SELLER.email,
        subject: bodies.subject,
        text: bodies.text,
        html: bodies.html,
        attachments,
      });

      // Persist
      await db.collection("orders").doc(proformaNumber.replace(/\//g, "_")).set({
        proformaNumber,
        ...data,
        ...totals,
        currency: CURRENCY,
        status: "awaiting_payment",
        issueDate: dates.issue,
        dueDate: dates.due,
        createdAt: FieldValue.serverTimestamp(),
      });

      logger.info("order.created", { proformaNumber, qty: data.qty, gross });
      res.status(200).json({ ok: true, proformaNumber });
    } catch (err) {
      logger.error("order.failed", err);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  }
);

// ── PayU: create an online (card/transfer) payment in EUR ────────────────────
// Validates + recomputes totals server-side, persists the order as
// `payu_pending`, creates the PayU order, and returns { redirectUri } for the
// browser to send the buyer to PayU. Fulfilment happens in payuNotify.
export const createPayuOrder = onRequest(
  { secrets: [PAYU_POS_ID, PAYU_CLIENT_ID, PAYU_CLIENT_SECRET], cors: CORS },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "method_not_allowed" });
      return;
    }
    try {
      const { errors, data } = validate(req.body || {});
      if (errors.length) {
        res.status(400).json({ ok: false, error: "invalid_input", fields: errors });
        return;
      }

      const totals = computeTotals(data.qty);
      const orderNumber = await nextProformaNumber();
      const docId = orderNumber.replace(/\//g, "_");
      const docRef = db.collection("orders").doc(docId);

      await docRef.set({
        proformaNumber: orderNumber,
        ...data,
        ...totals,
        currency: CURRENCY,
        method: "payu",
        payuEnv: PAYU_ENV,
        status: "payu_pending",
        createdAt: FieldValue.serverTimestamp(),
      });

      const baseUrl = payuBaseUrl(PAYU_ENV);
      const accessToken = await getAccessToken({
        baseUrl,
        clientId: PAYU_CLIENT_ID.value(),
        clientSecret: PAYU_CLIENT_SECRET.value(),
      });

      const customerIp =
        (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
        req.socket?.remoteAddress ||
        "127.0.0.1";
      const unitMinor = Math.round(UNIT_GROSS * 100);

      const { orderId, redirectUri } = await payuCreateOrder({
        baseUrl,
        accessToken,
        posId: PAYU_POS_ID.value(),
        extOrderId: docId,
        amountMinor: Math.round(totals.gross * 100),
        currencyCode: PAYU_CURRENCY,
        description: `${PRODUCT_NAME} × ${totals.qty} (${orderNumber})`,
        products: [
          { name: PRODUCT_NAME, unitPrice: String(unitMinor), quantity: String(totals.qty) },
        ],
        buyer: { email: data.email, phone: data.phone, language: data.lang },
        customerIp,
        notifyUrl: `${FN_BASE}/payuNotify`,
        continueUrl: CONTINUE_URL,
      });

      await docRef.set({ payuOrderId: orderId }, { merge: true });

      logger.info("payu.order.created", { orderNumber, payuOrderId: orderId, qty: totals.qty });
      res.status(200).json({ ok: true, redirectUri, orderNumber });
    } catch (err) {
      logger.error("payu.order.failed", { err: String(err) });
      res.status(500).json({ ok: false, error: "server_error" });
    }
  }
);

// ── PayU: async payment notification (webhook) ───────────────────────────────
// Server-to-server. Verifies the OpenPayu-Signature, and on COMPLETED fulfils
// the order (keys + invoice + email). Idempotent; always 200s after a valid
// signature so PayU stops retrying.
export const payuNotify = onRequest(
  { secrets: [PAYU_SECOND_KEY, SMTP_PASS], cors: false },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("method_not_allowed");
      return;
    }
    try {
      const valid = verifyNotificationSignature({
        header: req.headers["openpayu-signature"],
        rawBody: req.rawBody,
        secondKey: PAYU_SECOND_KEY.value(),
      });
      if (!valid) {
        logger.warn("payu.notify.bad_signature");
        res.status(400).send("bad_signature");
        return;
      }

      const order = req.body?.order || {};
      const extOrderId = order.extOrderId;
      const status = order.status;
      if (!extOrderId) {
        res.status(200).send("ok");
        return;
      }

      const docRef = db.collection("orders").doc(extOrderId);
      const snap = await docRef.get();
      if (!snap.exists) {
        logger.warn("payu.notify.unknown_order", { extOrderId });
        res.status(200).send("ok");
        return;
      }

      // Only the webhook's COMPLETED status confirms payment (never the redirect).
      if (status !== "COMPLETED") {
        await docRef.set({ payuStatus: status }, { merge: true });
        res.status(200).send("ok");
        return;
      }

      // Mint keys + mark paid atomically (idempotent across PayU retries).
      const { keys, justCreated } = await markPaidAndIssueKeys(docRef, order.orderId);

      // Send invoice + key email once. justCreated → first time; otherwise only
      // if a previous attempt minted keys but failed before emailing.
      if (justCreated || !snap.get("confirmedAt")) {
        const data = snap.data();
        const totals = computeTotals(data.qty);
        await sendFulfilment(docRef, data, totals, data.proformaNumber || extOrderId, keys);
      }
      logger.info("payu.notify.completed", { extOrderId, justCreated, keys: keys.length });

      res.status(200).send("ok");
    } catch (err) {
      logger.error("payu.notify.failed", { err: String(err) });
      // 500 → PayU will retry the notification later.
      res.status(500).send("error");
    }
  }
);
