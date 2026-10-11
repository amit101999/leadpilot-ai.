import { NextResponse } from "next/server";
import { z } from "zod";
import { paginated, parseJson, parseQuery, userRoute } from "@/lib/http/api";
import { runStatus } from "@/lib/database/schema";
import { AppError } from "@/lib/http/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import {
  idempotencyKeySchema,
  paginationQuery,
  q,
  resolvePagination,
  uuidParam,
} from "@/lib/validation/common";
import { getProviders } from "@/modules/providers";
import { createRun, listRuns, RUN_SORT_COLUMNS } from "@/modules/runs/service";

const listQuery = z.object({
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

export const GET = userRoute("VIEWER", async ({ req, db, actor }) => {
  const query = parseQuery(req, listQuery);
  const page = resolvePagination(query);
  const { items, total } = await listRuns(db, actor, { ...query, ...page });
  return paginated(items, { page: page.page, pageSize: page.pageSize, total });
});

const createBody = z.object({ profileId: uuidParam });

/**
 * Starts a run. The Idempotency-Key header makes double submissions safe: the
 * same key returns the original run (200) instead of creating another (201).
 */
export const POST = userRoute("OPERATOR", async ({ req, db, actor, requestId }) => {
  const header = req.headers.get("idempotency-key");
  if (!header) throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required");
  const idempotencyKey = idempotencyKeySchema.parse(header);
  await enforceRateLimit(db, RATE_LIMITS.runCreate, `user:${actor.id}`);
  const { profileId } = await parseJson(req, createBody);
  const { run, created } = await createRun(
    db,
    getProviders(),
    actor,
    { profileId, idempotencyKey },
    requestId,
  );
  return NextResponse.json({ data: run }, { status: created ? 201 : 200 });
});
