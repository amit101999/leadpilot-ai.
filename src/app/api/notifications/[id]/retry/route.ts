import { z } from "zod";
import { parseJson, userRoute } from "@/lib/http/api";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { uuidParam } from "@/lib/validation/common";
import { retryNotification } from "@/modules/notifications/service";
import { getProviders } from "@/modules/providers";

const body = z.object({ confirmNotReceived: z.boolean().optional() });

/** Manual resend of a failed or uncertain notification (rules in retryNotification). */
export const POST = userRoute("OPERATOR", async ({ req, db, actor, params, requestId }) => {
  const id = uuidParam.parse(params.id);
  await enforceRateLimit(db, RATE_LIMITS.notificationRetry, `user:${actor.id}`);
  const input = await parseJson(req, body);
  return retryNotification(db, getProviders(), actor, id, input, requestId);
});
