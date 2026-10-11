import { userRoute } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { getRun } from "@/modules/runs/service";

/** Run detail, including its immutable configuration snapshot and stage rows. */
export const GET = userRoute("VIEWER", async ({ db, actor, params }) =>
  getRun(db, actor, uuidParam.parse(params.id)),
);
