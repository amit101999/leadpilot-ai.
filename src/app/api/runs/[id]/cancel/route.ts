import { userRoute } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { cancelRun } from "@/modules/runs/service";

/** Cooperative: a queued run stops immediately, a running one at its next step boundary. */
export const POST = userRoute("OPERATOR", async ({ db, actor, params, requestId }) =>
  cancelRun(db, actor, uuidParam.parse(params.id), requestId),
);
