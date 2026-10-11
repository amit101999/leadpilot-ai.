import { parseJson, userRoute } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { updateProfileSchema } from "@/modules/profiles/schema";
import { getProfile, updateProfile } from "@/modules/profiles/service";

export const GET = userRoute("VIEWER", async ({ db, actor, params }) =>
  getProfile(db, actor, uuidParam.parse(params.id)),
);

/** Saves a new version. `expectedVersion` provides optimistic locking (409 VERSION_CONFLICT). */
export const PATCH = userRoute("OPERATOR", async ({ req, db, actor, params, requestId }) => {
  const id = uuidParam.parse(params.id);
  const input = await parseJson(req, updateProfileSchema);
  return updateProfile(db, actor, id, input, requestId);
});
