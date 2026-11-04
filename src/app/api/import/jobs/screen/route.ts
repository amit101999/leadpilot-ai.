import { parseJson, tokenRoute } from "@/lib/http/api";
import { importJobsSchema, screenJobs } from "@/modules/imports/service";

/** POST /api/import/jobs/screen — checks search results against the profile's rules; stores nothing. */
export const POST = tokenRoute("OPERATOR", async ({ req, db, actor }) => {
  const input = await parseJson(req, importJobsSchema);
  return screenJobs(db, actor, input);
});
