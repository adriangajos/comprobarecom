/**
 * Local Gmail SMTP credential check — does NOT touch Firebase.
 *
 * 1. Put the comprobareapp@gmail.com Gmail APP PASSWORD (16 chars, no spaces)
 *    in a file (gitignored):  functions/.smtp_pass.txt   (just the password)
 * 2. Run:  node functions/test-smtp.js
 *
 * It tries the Gmail endpoints and tells you which one authenticates.
 * The password is read from the file so it never appears on screen.
 *
 * Note: Gmail requires 2-Step Verification enabled, then an App Password
 * (Google Account → Security → App passwords). A normal account password
 * will be rejected with 535.
 */
import nodemailer from "nodemailer";
import { readFileSync } from "fs";

const USER = "comprobareapp@gmail.com";
let pass;
try {
  pass = readFileSync(new URL("./.smtp_pass.txt", import.meta.url), "utf8").replace(/\r?\n$/, "");
} catch {
  console.error("Create functions/.smtp_pass.txt containing the Gmail app password, then re-run.");
  process.exit(1);
}
console.log(`Password loaded: ${pass.length} characters (user: ${USER})`);

const candidates = [
  { host: "smtp.gmail.com", port: 465, secure: true },
  { host: "smtp.gmail.com", port: 587, secure: false },
];

const run = async () => {
  for (const c of candidates) {
    const t = nodemailer.createTransport({ ...c, auth: { user: USER, pass } });
    process.stdout.write(`Trying ${c.host}:${c.port} (secure=${c.secure}) ... `);
    try {
      await t.verify();
      console.log("OK ✓  AUTH SUCCESS — use this host/port.");
      return;
    } catch (e) {
      console.log(`FAIL — ${e.responseCode || ""} ${e.message}`);
    }
  }
  console.log("\nBoth failed. Make sure SMTP_PASS is a Gmail *App Password* (2-Step Verification must be on).");
};
run();
