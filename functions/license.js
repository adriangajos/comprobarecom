/**
 * Comprobare license keys — generator + Firestore writer.
 *
 * Contract owner: the desktop app (comprobare/license.py). The app activates ANY
 * `COMP-...` key present in the `licenses/` collection, regardless of who wrote
 * it. This module is the ONLY thing the web backend shares with the app, so the
 * field names and key format below MUST NOT change. See
 * uploads/www_license_integration_contract.md.
 *
 * Port of admin_tools/generate_license.py (CSPRNG, identical format).
 */

import crypto from "crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const seg = (n = 4) =>
  Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");

/** Generate one license key, e.g. "COMP-AB12-CD34-EF56-GH78". */
export const genKey = () => `COMP-${seg()}-${seg()}-${seg()}-${seg()}`;

/**
 * Build the license document exactly as the desktop app expects.
 * `planDays === 0` → perpetual (expires_at = null); otherwise now + planDays.
 */
export function buildLicense({ key, email, planDays, orderId, maxDevices = 1, now = new Date() }) {
  return {
    key,
    email,
    status: "active",
    created_at: now.toISOString(),
    expires_at:
      planDays === 0 ? null : new Date(now.getTime() + planDays * 86400000).toISOString(),
    duration_days: planDays,
    note: `PayU ${orderId}`,
    activations: [],
    max_devices: maxDevices,
  };
}

/**
 * Reserve `count` unique keys and create their license documents inside the
 * given transaction. Firestore requires all reads before all writes, so we read
 * every candidate ref first (regenerating on the astronomically rare collision),
 * then write them all. Returns the array of created keys.
 *
 * Call this INSIDE the same transaction that marks the order processed, so PayU
 * notification retries can never mint duplicate keys.
 */
export async function createLicensesInTx(
  db,
  tx,
  { count, email, planDays, orderId, maxDevices = 1 }
) {
  const col = db.collection("licenses");

  // ── reads: pick `count` keys not already taken (in Firestore or this batch) ──
  const keys = [];
  for (let i = 0; i < count; i++) {
    let key;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      key = genKey();
      if (keys.includes(key)) continue;
      const snap = await tx.get(col.doc(key));
      if (!snap.exists) break;
    }
    keys.push(key);
  }

  // ── writes: create every license document ──
  const now = new Date();
  for (const key of keys) {
    tx.set(col.doc(key), buildLicense({ key, email, planDays, orderId, maxDevices, now }));
  }
  return keys;
}
