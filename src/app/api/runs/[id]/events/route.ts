import { NextResponse } from "next/server";
import { userRoute } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { getRunProgress } from "@/modules/runs/service";

/**
 * Progress snapshot for polling (every ~2 s until `terminal` is true): actual
 * stage states and counts computed from per-job records, never estimates.
 */
export const GET = userRoute("VIEWER", async ({ db, actor, params }) => {
  const progress = await getRunProgress(db, actor, uuidParam.parse(params.id));
  const { configurationSnapshot: _snapshot, leaseOwner: _lease, ...run } = progress.run;
  return NextResponse.json(
    { data: { run, counters: progress.counters, terminal: progress.terminal } },
    { headers: { "cache-control": "no-store" } },
  );
});
