import { z } from "zod";
import { paginated, parseQuery, userRoute } from "@/lib/http/api";
import { paginationQuery, q, resolvePagination } from "@/lib/validation/common";
import { listAuditLogs } from "@/modules/audit/service";

const listQuery = z.object({
  ...paginationQuery,
  action: q.string(100),
  entityType: q.string(100),
  entityId: q.string(100),
  userId: q.uuid(),
  from: q.date(),
  // Same as the audit page: a date-only "to" includes that whole day.
  to: q.endDate(),
});

export const GET = userRoute("ADMIN", async ({ req, db, actor }) => {
  const query = parseQuery(req, listQuery);
  const page = resolvePagination(query);
  const { items, total } = await listAuditLogs(db, actor, { ...query, ...page });
  return paginated(items, { page: page.page, pageSize: page.pageSize, total });
});
