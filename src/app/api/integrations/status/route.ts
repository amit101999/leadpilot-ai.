import { userRoute } from "@/lib/http/api";
import { getIntegrationStatuses } from "@/modules/integrations/service";
import { getProviders } from "@/modules/providers";

/** Last stored check per integration (never calls external services). */
export const GET = userRoute("VIEWER", async ({ db }) => getIntegrationStatuses(db, getProviders()));
