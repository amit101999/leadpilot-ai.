import { z } from "zod";
import { parseJson, userRoute } from "@/lib/http/api";
import { notFound } from "@/lib/http/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { uuidParam } from "@/lib/validation/common";
import { sendTestMessage } from "@/modules/notifications/service";
import { getProviders } from "@/modules/providers";

const body = z.object({ recipientId: uuidParam });

const TEST_CHANNELS = { whatsapp: "WHATSAPP", email: "EMAIL" } as const;

/**
 * POST /api/integrations/{whatsapp|email}/test: sends a connection test to an
 * opted-in recipient of that channel. Lives under [provider] so it does not
 * shadow /api/integrations/[provider]/check.
 */
export const POST = userRoute("OPERATOR", async ({ req, db, actor, params, requestId }) => {
  const channel = TEST_CHANNELS[params.provider as keyof typeof TEST_CHANNELS];
  if (!channel) throw notFound("Integration test");
  await enforceRateLimit(db, RATE_LIMITS.whatsappTest, `user:${actor.id}`);
  const { recipientId } = await parseJson(req, body);
  return sendTestMessage(db, getProviders(), actor, recipientId, requestId, channel);
});
