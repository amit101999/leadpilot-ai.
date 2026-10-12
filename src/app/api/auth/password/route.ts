import { parseJson, userRoute } from "@/lib/http/api";
import { changePassword, changePasswordSchema } from "@/modules/auth/service";

/** Change the signed-in user's own password; other sessions of the user are signed out. */
export const POST = userRoute("VIEWER", async ({ req, db, user, requestId }) => {
  const input = await parseJson(req, changePasswordSchema);
  return changePassword(db, { id: user.id, sessionId: user.sessionId }, input, requestId);
});
