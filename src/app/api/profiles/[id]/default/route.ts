import { userRoute } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { setDefault } from "@/modules/profiles/service";

export const POST = userRoute("OPERATOR", async ({ db, actor, params, requestId }) =>
  setDefault(db, actor, uuidParam.parse(params.id), requestId),
);
