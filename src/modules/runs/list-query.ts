import { z } from "zod";
import { runStatus } from "@/lib/database/schema";
import { paginationQuery, q } from "@/lib/validation/common";
import { RUN_SORT_COLUMNS } from "./service";

/** Search History filters. Shared by GET /api/runs and the runs CSV export. */
export const runListQuery = z.object({
  ...paginationQuery,
  profileId: q.uuid(),
  status: q.enumList(runStatus.enumValues),
  from: q.date(),
  to: q.date(),
  minQualified: q.int(0, 100_000),
  failedOnly: q.bool(),
  notificationFailures: q.bool(),
  search: q.string(100),
  sort: q.enumOf(Object.keys(RUN_SORT_COLUMNS) as [keyof typeof RUN_SORT_COLUMNS]),
});
