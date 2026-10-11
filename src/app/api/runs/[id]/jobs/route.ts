import { userRoute } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { listRunJobs } from "@/modules/jobs/queries";

export const GET = userRoute("VIEWER", async ({ db, actor, params }) =>
  listRunJobs(db, actor, uuidParam.parse(params.id)),
);
