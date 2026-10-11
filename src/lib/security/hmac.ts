import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-to-server request signing (n8n -> app internal endpoints).
 * Header format: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`.
 * The timestamp bounds replay to a short window.
 */
export const SIGNATURE_HEADER = "x-leadpilot-signature";
export const MAX_CLOCK_SKEW_SECONDS = 300;

export function signPayload(
  secret: string,
  body: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): string {
  const digest = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

export function verifySignature(
  secret: string,
  body: string,
  header: string | null,
  nowSeconds = Math.floor(Date.now() / 1000),
): SignatureCheck {
  if (!header) return { ok: false, reason: "missing signature" };
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }),
  );
  const timestamp = Number(parts.t);
  const provided = parts.v1;
  if (!Number.isInteger(timestamp) || !provided) return { ok: false, reason: "malformed signature" };
  if (Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS)
    return { ok: false, reason: "stale signature" };
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return safeEqualHex(expected, provided) ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

/** Meta webhook signature: `sha256=<hex HMAC of raw body with the app secret>`. */
export function verifyMetaSignature(appSecret: string, body: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(body).digest("hex");
  return safeEqualHex(expected, header.slice("sha256=".length));
}

function safeEqualHex(expected: string, provided: string): boolean {
  if (!/^[0-9a-f]+$/i.test(provided) || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
}
