import { userRoute } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { revokeImportToken } from "@/modules/imports/tokens";

export const POST = userRoute("OPERATOR", async ({ db, actor, params, requestId }) =>
  revokeImportToken(db, actor, uuidParam.parse(params.id), requestId),
);
