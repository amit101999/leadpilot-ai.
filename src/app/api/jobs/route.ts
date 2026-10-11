import { z } from "zod";
import { jobProcessingStatus } from "@/lib/database/schema";
import { paginated, parseQuery, userRoute } from "@/lib/http/api";
import { paginationQuery, q, resolvePagination } from "@/lib/validation/common";
import { listJobs } from "@/modules/jobs/queries";

const listQuery = z.object({
  ...paginationQuery,
  profileId: q.uuid(),
  status: q.enumList(jobProcessingStatus.enumValues),
  search: q.string(200),
  previouslySeen: q.bool(),
  notified: q.bool(),
  source: q.string(50),
  sort: q.enumOf(["firstSeen", "lastChecked", "budget", "score", "title"] as const),
});

export const GET = userRoute("VIEWER", async ({ req, db, actor }) => {
  const query = parseQuery(req, listQuery);
  const page = resolvePagination(query);
  const { items, total } = await listJobs(db, actor, { ...query, ...page });
  return paginated(items, { page: page.page, pageSize: page.pageSize, total });
});
