import { z } from "zod";
import { notificationStatus } from "@/lib/database/schema";
import { paginated, parseQuery, userRoute } from "@/lib/http/api";
import { paginationQuery, q, resolvePagination } from "@/lib/validation/common";
import { listNotifications } from "@/modules/notifications/service";

const listQuery = z.object({
  ...paginationQuery,
  status: q.enumList(notificationStatus.enumValues),
  runId: q.uuid(),
  profileId: q.uuid(),
  search: q.string(200),
});

export const GET = userRoute("VIEWER", async ({ req, db, actor }) => {
  const query = parseQuery(req, listQuery);
  const page = resolvePagination(query);
  const { items, total } = await listNotifications(db, actor, { ...query, ...page });
  return paginated(items, { page: page.page, pageSize: page.pageSize, total });
});
