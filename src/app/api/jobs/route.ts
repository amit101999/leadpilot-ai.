import { paginated, parseQuery, userRoute } from "@/lib/http/api";
import { resolvePagination } from "@/lib/validation/common";
import { jobListQuery } from "@/modules/jobs/list-query";
import { listJobs } from "@/modules/jobs/queries";

export const GET = userRoute("VIEWER", async ({ req, db, actor }) => {
  const query = parseQuery(req, jobListQuery);
  const page = resolvePagination(query);
  const { items, total } = await listJobs(db, actor, { ...query, ...page });
  return paginated(items, { page: page.page, pageSize: page.pageSize, total });
});
