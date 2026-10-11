import { z } from "zod";
import { notificationStatus, qualificationDecision } from "@/lib/database/schema";
import { paginated, parseQuery, userRoute } from "@/lib/http/api";
import { isDecimalString } from "@/lib/money/decimal";
import { paginationQuery, q, resolvePagination } from "@/lib/validation/common";
import { listLeads } from "@/modules/jobs/queries";

const amount = q.string(20).refine((v) => v === undefined || isDecimalString(v), "Invalid amount");

const listQuery = z.object({
  ...paginationQuery,
  profileId: q.uuid(),
  decision: q.enumList(qualificationDecision.enumValues),
  budgetMin: amount,
  budgetMax: amount,
  scoreMin: q.int(0, 100),
  scoreMax: q.int(0, 100),
  skill: q.string(80),
  paymentVerified: q.enumOf(["true", "false", "unknown"] as const),
  discoveredFrom: q.date(),
  discoveredTo: q.date(),
  notificationStatus: q.enumList([...notificationStatus.enumValues, "NONE"] as const),
  search: q.string(200),
  sort: q.enumOf(["score", "firstSeen", "lastChecked", "budget"] as const),
});

export const GET = userRoute("VIEWER", async ({ req, db, actor }) => {
  const query = parseQuery(req, listQuery);
  const page = resolvePagination(query);
  const { items, total } = await listLeads(db, actor, { ...query, ...page });
  return paginated(items, { page: page.page, pageSize: page.pageSize, total });
});
