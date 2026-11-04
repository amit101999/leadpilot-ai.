import { parseJson, tokenRoute } from "@/lib/http/api";
import { recordSyncStatus, syncStatusSchema } from "@/modules/imports/service";

/** POST /api/import/sync-status — the agent reports that a profile was synced (or why not). */
export const POST = tokenRoute("OPERATOR", async ({ req, db, actor }) => {
  const input = await parseJson(req, syncStatusSchema);
  return recordSyncStatus(db, actor, input);
});
