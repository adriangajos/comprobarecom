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
const CURRENCY = "EUR";
const PROFORMA_VALID_DAYS = 7;

// Public order endpoint — allow any origin (CORS is not a meaningful control
// here since the endpoint can be called server-side regardless; abuse is
// handled by validation + maxInstances). This also lets the page be tested
// locally (file:// sends origin "null").
const CORS = true;

// ── helpers ─────────────────────────────────────────────────────────────────
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const eur = (n) => `${round2(n).toFixed(2)} ${CURRENCY}`;

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
    let current = 0;
    if (snap.exists && snap.get("year") === year) current = snap.get("seq") || 0;
    const next = current + 1;
    tx.set(ref, { year, seq: next }, { merge: true });
    return next;
  });
  return `PF/${year}/${String(seq).padStart(4, "0")}`;
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

export function buildProformaPdf({ proformaNumber, order, totals, dates }) {
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
      .text(`Pay by: ${dates.due}`, { width: right - left, align: "right" });

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
    doc.text("Method: bank transfer", left, y + 14);
    doc.text(`Account holder: ${SELLER.bank.accountHolder}`);
    doc.text(`Bank: ${SELLER.bank.bankName}`);
    doc.text(`IBAN: ${SELLER.bank.iban}`);
    doc.text(`SWIFT/BIC: ${SELLER.bank.swift}`);
    doc.text(`Payment reference: ${proformaNumber}`);

    // Note
    y = doc.y + 18;
    doc.rect(left, y, right - left, 60).fill("#f4f7fb");
    doc.fillColor(DARK).fontSize(9.5).font("Body")
      .text(
        "This is a proforma invoice, not a VAT invoice. After we receive your payment on the bank " +
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

      // Server-side totals (gross = €100/license incl. VAT).
      const gross = round2(UNIT_GROSS * data.qty);
      const net = round2(gross / (1 + VAT_RATE));
      const vat = round2(gross - net);
      const totals = { qty: data.qty, net, vat, gross };

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
