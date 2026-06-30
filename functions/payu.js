/**
 * PayU REST API (Checkout) client for the Comprobare EUR shop.
 *
 * Flow:
 *   1. OAuth (client_credentials) → access token.
 *   2. OrderCreateRequest → PayU returns a redirectUri the buyer is sent to.
 *   3. PayU POSTs an async notification to our notifyUrl; we verify the
 *      OpenPayu-Signature header before trusting it.
 *
 * Env switch (PAYU_ENV): "sandbox" (default) → secure.snd.payu.com,
 *                        "production"        → secure.payu.com.
 *
 * Credentials come from secrets (see index.js):
 *   PAYU_POS_ID, PAYU_CLIENT_ID, PAYU_CLIENT_SECRET, PAYU_SECOND_KEY.
 *   On the PayU "eur" REST API (Checkout) point, client_id is usually the
 *   POS id and PAYU_SECOND_KEY is "Klucz drugi (MD5)".
 */

import crypto from "crypto";

export function payuBaseUrl(env) {
  return env === "production" ? "https://secure.payu.com" : "https://secure.snd.payu.com";
}

/** Get an OAuth access token (client_credentials grant). */
export async function getAccessToken({ baseUrl, clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(`${baseUrl}/pl/standard/user/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`payu_oauth_failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

/**
 * Create a PayU order. Returns { orderId, redirectUri, extOrderId }.
 * amountMinor must be an integer in minor units (cents).
 */
export async function createPayuOrder({
  baseUrl,
  accessToken,
  posId,
  extOrderId,
  amountMinor,
  currencyCode,
  description,
  products,
  buyer,
  customerIp,
  notifyUrl,
  continueUrl,
}) {
  const payload = {
    notifyUrl,
    continueUrl,
    customerIp,
    merchantPosId: posId,
    description,
    currencyCode,
    totalAmount: String(amountMinor),
    extOrderId,
    buyer,
    products,
  };

  // PayU answers OrderCreate with a 302 whose body carries the redirectUri.
  // We must NOT auto-follow it, otherwise we'd fetch the payment page itself.
  const res = await fetch(`${baseUrl}/api/v2_1/orders`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));
  const statusCode = json?.status?.statusCode;
  // SUCCESS = order created and a redirect URL was issued.
  // WARNING_CONTINUE_3DS / _CVV are also valid "go to redirectUri" outcomes.
  const ok =
    res.status === 302 ||
    res.status === 201 ||
    (res.status === 200 &&
      (statusCode === "SUCCESS" ||
        statusCode === "WARNING_CONTINUE_3DS" ||
        statusCode === "WARNING_CONTINUE_CVV"));

  if (!ok || !json.redirectUri) {
    throw new Error(`payu_order_failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return { orderId: json.orderId, redirectUri: json.redirectUri, extOrderId: json.extOrderId };
}

/**
 * Verify the OpenPayu-Signature header on an incoming notification.
 *
 * Header form: "sender=...;signature=<hex>;algorithm=MD5;content=DOCUMENT".
 * Expected signature = md5(rawBody + secondKey). Always compare against the
 * RAW request body (not a re-serialized object) — key ordering must match.
 */
export function verifyNotificationSignature({ header, rawBody, secondKey }) {
  if (!header || !rawBody) return false;
  const parts = Object.fromEntries(
    String(header)
      .split(";")
      .map((kv) => kv.split("="))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k.trim(), v.trim()])
  );
  const incoming = (parts.signature || "").toLowerCase();
  const algorithm = (parts.algorithm || "MD5").toUpperCase();
  if (!incoming) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const algo = algorithm === "SHA-256" ? "sha256" : "md5";
  const expected = crypto
    .createHash(algo)
    .update(Buffer.concat([body, Buffer.from(secondKey)]))
    .digest("hex");

  // Constant-time compare to avoid leaking via timing.
  const a = Buffer.from(incoming);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
