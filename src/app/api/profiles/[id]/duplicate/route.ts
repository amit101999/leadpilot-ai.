import { parseJson, userRoute } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { duplicateProfileSchema } from "@/modules/profiles/schema";
import { duplicateProfile } from "@/modules/profiles/service";

export const POST = userRoute("OPERATOR", async ({ req, db, actor, params, requestId }) => {
  const id = uuidParam.parse(params.id);
  const { name } = await parseJson(req, duplicateProfileSchema);
  return duplicateProfile(db, actor, id, name, requestId);
});
