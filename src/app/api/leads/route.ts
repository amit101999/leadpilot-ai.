import { paginated, parseQuery, userRoute } from "@/lib/http/api";
import { resolvePagination } from "@/lib/validation/common";
import { leadListQuery } from "@/modules/jobs/list-query";
import { listLeads } from "@/modules/jobs/queries";

export const GET = userRoute("VIEWER", async ({ req, db, actor }) => {
  const query = parseQuery(req, leadListQuery);
  const page = resolvePagination(query);
  const { items, total } = await listLeads(db, actor, { ...query, ...page });
  return paginated(items, { page: page.page, pageSize: page.pageSize, total });
});
