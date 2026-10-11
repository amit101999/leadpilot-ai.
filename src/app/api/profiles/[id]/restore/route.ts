import { userRoute } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { setArchived } from "@/modules/profiles/service";

export const POST = userRoute("OPERATOR", async ({ db, actor, params, requestId }) =>
  setArchived(db, actor, uuidParam.parse(params.id), false, requestId),
);
