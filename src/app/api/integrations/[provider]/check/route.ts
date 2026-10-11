import { z } from "zod";
import { userRoute } from "@/lib/http/api";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { checkIntegration, INTEGRATIONS } from "@/modules/integrations/service";
import { getProviders } from "@/modules/providers";

const providerParam = z.enum(INTEGRATIONS);

/** "Test connection": runs one live check and stores the result. */
export const POST = userRoute("OPERATOR", async ({ db, actor, params }) => {
  const name = providerParam.parse(params.provider);
  await enforceRateLimit(db, RATE_LIMITS.integrationCheck, `user:${actor.id}`);
  return checkIntegration(db, getProviders(), name);
});
