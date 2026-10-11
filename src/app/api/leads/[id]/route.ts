import { userRoute } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { getJobDetail } from "@/modules/jobs/queries";

/** A lead is a job with qualification records; its detail is the job detail (AI assessment, checks, notifications). */
export const GET = userRoute("VIEWER", async ({ db, actor, params }) =>
  getJobDetail(db, actor, uuidParam.parse(params.id)),
);
