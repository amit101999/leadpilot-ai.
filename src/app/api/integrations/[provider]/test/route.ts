import { z } from "zod";
import { parseJson, userRoute } from "@/lib/http/api";
import { notFound } from "@/lib/http/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { uuidParam } from "@/lib/validation/common";
import { sendTestMessage } from "@/modules/notifications/service";
import { getProviders } from "@/modules/providers";

const body = z.object({ recipientId: uuidParam });

/**
 * POST /api/integrations/email/test: sends a test e-mail to an opted-in recipient.
 * Lives under [provider] so it does not shadow /api/integrations/[provider]/check.
 */
export const POST = userRoute("OPERATOR", async ({ req, db, actor, params, requestId }) => {
  if (params.provider !== "email") throw notFound("Integration test");
  await enforceRateLimit(db, RATE_LIMITS.testMessage, `user:${actor.id}`);
  const { recipientId } = await parseJson(req, body);
  return sendTestMessage(db, getProviders(), actor, recipientId, requestId);
});
