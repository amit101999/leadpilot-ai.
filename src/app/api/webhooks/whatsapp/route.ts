import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/configuration/env";
import { publicRoute, readBody } from "@/lib/http/api";
import { AppError } from "@/lib/http/errors";
import { childLogger } from "@/lib/logging/logger";
import { verifyMetaSignature } from "@/lib/security/hmac";
import { applyStatusEvents, parseStatusWebhook } from "@/modules/notifications/webhook";

const CHALLENGE_RE = /^[A-Za-z0-9_-]{1,128}$/;

function sameSecret(a: string, b: string): boolean {
  // Hash first so the comparison is constant-time regardless of input length.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Meta's subscription handshake: echo hub.challenge when the verify token matches. */
export const GET = publicRoute(async ({ req }) => {
  const expected = env().WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!expected) throw new AppError("INTEGRATION_NOT_CONFIGURED", "WhatsApp webhook is not configured");
  const params = req.nextUrl.searchParams;
  const challenge = params.get("hub.challenge") ?? "";
  if (
    params.get("hub.mode") !== "subscribe" ||
    !sameSecret(params.get("hub.verify_token") ?? "", expected) ||
    !CHALLENGE_RE.test(challenge)
  ) {
    throw new AppError("FORBIDDEN", "Webhook verification failed");
  }
  return new NextResponse(challenge, { headers: { "content-type": "text/plain; charset=utf-8" } });
});

/**
 * Delivery-status updates. The raw body (which contains phone numbers) is
 * verified, parsed and discarded; only resulting status changes are stored and
 * only counts are logged. Unknown message ids are acknowledged with 200 so Meta
 * does not retry them.
 */
export const POST = publicRoute(async ({ req, db, requestId }) => {
  const secret = env().WHATSAPP_APP_SECRET;
  if (!secret) throw new AppError("INTEGRATION_NOT_CONFIGURED", "WhatsApp webhook is not configured");
  const raw = await readBody(req);
  if (!verifyMetaSignature(secret, raw, req.headers.get("x-hub-signature-256"))) {
    throw new AppError("INVALID_SIGNATURE", "Invalid webhook signature");
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Body must be valid JSON");
  }
  const result = await applyStatusEvents(db, parseStatusWebhook(body));
  childLogger({ request_id: requestId }).info(result, "WhatsApp status webhook processed");
  return result;
});
