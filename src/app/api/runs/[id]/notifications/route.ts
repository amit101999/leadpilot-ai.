import { z } from "zod";
import { paginated, parseQuery, userRoute } from "@/lib/http/api";
import { paginationQuery, resolvePagination, uuidParam } from "@/lib/validation/common";
import { listNotifications } from "@/modules/notifications/service";
import { getRun } from "@/modules/runs/service";

const listQuery = z.object({ ...paginationQuery });

export const GET = userRoute("VIEWER", async ({ req, db, actor, params }) => {
  const runId = uuidParam.parse(params.id);
  await getRun(db, actor, runId); // 404 if the run is not visible to this user
  const page = resolvePagination(parseQuery(req, listQuery));
  const { items, total } = await listNotifications(db, actor, { ...page, runId });
  return paginated(items, { page: page.page, pageSize: page.pageSize, total });
});
