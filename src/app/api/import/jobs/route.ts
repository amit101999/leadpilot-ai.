import { NextResponse } from "next/server";
import { parseJson, tokenRoute } from "@/lib/http/api";
import { commitJobs, importJobsSchema } from "@/modules/imports/service";
import { getProviders } from "@/modules/providers";

/** POST /api/import/jobs — stores the jobs (deduplicated) and starts or queues an import run. */
export const POST = tokenRoute("OPERATOR", async ({ req, db, actor, requestId }) => {
  const input = await parseJson(req, importJobsSchema);
  const result = await commitJobs(db, getProviders(), actor, input, requestId);
  return NextResponse.json({ data: result }, { status: result.status === "NOTHING_TO_IMPORT" ? 200 : 202 });
});
