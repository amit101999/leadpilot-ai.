import { parseJson, userRoute } from "@/lib/http/api";
import { scheduleSchema } from "@/modules/scheduler/schema";
import { getSchedule, updateSchedule } from "@/modules/scheduler/service";

/** The signed-in user's Upwork sync scheduler (the default when never saved). */
export const GET = userRoute("VIEWER", async ({ db, actor }) => getSchedule(db, actor.id));

export const PUT = userRoute("OPERATOR", async ({ req, db, actor, requestId }) => {
  const input = await parseJson(req, scheduleSchema);
  return updateSchedule(db, actor, input, requestId);
});
