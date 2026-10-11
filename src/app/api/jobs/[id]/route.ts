import { userRoute } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { getJobDetail } from "@/modules/jobs/queries";

export const GET = userRoute("VIEWER", async ({ db, actor, params }) =>
  getJobDetail(db, actor, uuidParam.parse(params.id)),
);
