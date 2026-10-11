import { parseJson, userRoute } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { updateRecipient, updateRecipientSchema } from "@/modules/notifications/recipients";

export const PATCH = userRoute("OPERATOR", async ({ req, db, actor, params, requestId }) => {
  const id = uuidParam.parse(params.id);
  const input = await parseJson(req, updateRecipientSchema);
  return updateRecipient(db, actor, id, input, requestId);
});
