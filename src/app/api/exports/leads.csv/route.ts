import { parseQuery, userRoute } from "@/lib/http/api";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { csvResponse } from "@/modules/exports/http";
import { exportLeadsCsv } from "@/modules/exports/service";
import { leadListQuery } from "@/modules/jobs/list-query";

/** Same filters as GET /api/leads; capped at EXPORT_ROW_LIMIT rows. */
export const GET = userRoute("VIEWER", async ({ req, db, actor }) => {
  await enforceRateLimit(db, RATE_LIMITS.export, `user:${actor.id}`);
  const { page: _page, pageSize: _pageSize, ...filters } = parseQuery(req, leadListQuery);
  return csvResponse("leads", await exportLeadsCsv(db, actor, filters));
});
