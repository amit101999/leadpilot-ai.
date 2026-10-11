import { userRoute } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { resumeRun } from "@/modules/runs/service";

/** Re-dispatches a run whose executor stopped (lease expired); steps are idempotent. */
export const POST = userRoute("OPERATOR", async ({ db, actor, params, requestId }) =>
  resumeRun(db, actor, uuidParam.parse(params.id), requestId),
);
