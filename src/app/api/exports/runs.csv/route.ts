import { parseQuery, userRoute } from "@/lib/http/api";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { csvResponse } from "@/modules/exports/http";
import { exportRunsCsv } from "@/modules/exports/service";
import { runListQuery } from "@/modules/runs/list-query";

/** Same filters as GET /api/runs; capped at EXPORT_ROW_LIMIT rows. */
export const GET = userRoute("VIEWER", async ({ req, db, actor }) => {
  await enforceRateLimit(db, RATE_LIMITS.export, `user:${actor.id}`);
  const { page: _page, pageSize: _pageSize, ...filters } = parseQuery(req, runListQuery);
  return csvResponse("runs", await exportRunsCsv(db, actor, filters));
});
