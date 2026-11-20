import { userRoute } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { setActive } from "@/modules/profiles/service";

/** Makes the profile the owner's active one (the only profile the Upwork sync fetches for). */
export const POST = userRoute("OPERATOR", async ({ db, actor, params, requestId }) =>
  setActive(db, actor, uuidParam.parse(params.id), requestId),
);
