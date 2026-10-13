import { and, eq, inArray, sql } from "drizzle-orm";
import { env } from "@/lib/configuration/env";
import type { Database, DbExecutor } from "@/lib/database/client";
import { agentRuns, notifications, qualifications, runJobs, runStages } from "@/lib/database/schema";
import { AppError, notFound } from "@/lib/http/errors";
import { childLogger } from "@/lib/logging/logger";
import { sanitizeErrorMessage } from "@/lib/security/sanitize";
import { allowedFrom, isTerminal } from "@/lib/state-machine";
import type { Providers } from "@/modules/providers";
import type { RunStage, RunStatus } from "@/types/domain";
import { parseSnapshot, type RunSnapshot } from "../snapshot";
import { RUN_TRANSITIONS } from "../transitions";

export type RunRow = typeof agentRuns.$inferSelect;

/** Stage names exposed to executors, in pipeline order. */
export const STAGE_STEPS = [
  "start",
  "discover",
  "filter",
  "evaluate",
  "select",
  "notify",
  "finalize",
] as const;
export type StageStep = (typeof STAGE_STEPS)[number];

export const STEP_TO_STAGE: Record<StageStep, RunStage> = {
  start: "SOURCE_CHECK",
  discover: "DISCOVERY",
  filter: "HARD_FILTERS",
  evaluate: "AI_EVALUATION",
  select: "SELECTION",
  notify: "NOTIFICATION",
  finalize: "FINALIZATION",
};

export interface StageResponse {
  runId: string;
  step: StageStep;
  runStatus: RunStatus;
  /** True when the run has reached a final status; the executor should stop. */
  terminal: boolean;
  /** Next step to call, or null when terminal. */
  next: StageStep | null;
  remaining?: number;
  /** When > 0 the executor should wait this long before calling `next`. */
  retryAfterMs?: number;
  message?: string;
}

export interface RunContext {
  db: Database;
  run: RunRow;
  snapshot: RunSnapshot;
  executorId: string;
  providers: Providers;
  log: ReturnType<typeof childLogger>;
}

export async function loadRun(db: DbExecutor, runId: string): Promise<RunRow> {
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  if (!run) throw notFound("Run");
  return run;
}

/**
 * Takes or renews the execution lease. Only one executor may drive a run at a
 * time; a crashed executor's lease expires and the run can be resumed.
 * Returns null when the run is already terminal.
 */
export async function acquireLease(db: Database, runId: string, executorId: string): Promise<RunRow | null> {
  const seconds = env().RUN_LEASE_SECONDS;
  const [run] = await db
    .update(agentRuns)
    .set({
      leaseOwner: executorId,
      leaseExpiresAt: sql`now() + make_interval(secs => ${seconds})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentRuns.id, runId),
        inArray(agentRuns.status, ["QUEUED", "RUNNING"]),
        sql`(${agentRuns.leaseOwner} is null or ${agentRuns.leaseOwner} = ${executorId} or ${agentRuns.leaseExpiresAt} < now())`,
      ),
    )
    .returning();
  if (run) return run;
  const current = await loadRun(db, runId);
  if (isTerminal(RUN_TRANSITIONS, current.status)) return null;
  throw new AppError("LEASE_HELD", "Another executor is currently processing this run");
}

/**
 * Refuses when a different executor holds an unexpired lease, so a duplicate
 * n8n execution cannot fail a run that another execution is still driving.
 * Without an executor id ownership cannot be proven, so any live lease blocks.
 */
export async function assertNoOtherLeaseHolder(
  db: DbExecutor,
  runId: string,
  executorId: string | null,
): Promise<void> {
  await loadRun(db, runId);
  const [held] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.id, runId),
        sql`${agentRuns.leaseOwner} is not null`,
        sql`${agentRuns.leaseExpiresAt} > now()`,
        executorId === null ? sql`true` : sql`${agentRuns.leaseOwner} <> ${executorId}`,
      ),
    )
    .limit(1);
  if (held) throw new AppError("LEASE_HELD", "Another executor is currently processing this run");
}

export async function enterRun(
  db: Database,
  runId: string,
  executorId: string,
  providers: Providers,
): Promise<RunContext | RunRow> {
  const run = await acquireLease(db, runId, executorId);
  if (!run) return loadRun(db, runId);
  const snapshot = parseSnapshot(run.configurationSnapshot);
  return {
    db,
    run,
    snapshot,
    executorId,
    providers,
    log: childLogger({ run_id: run.id, profile_id: run.profileId }),
  };
}

export function terminalResponse(run: RunRow, step: StageStep): StageResponse {
  return { runId: run.id, step, runStatus: run.status, terminal: true, next: null };
}

/** Guarded status change: succeeds only from a state that may legally reach `to`. */
export async function transitionRun(
  db: DbExecutor,
  runId: string,
  to: RunStatus,
  extra: Partial<typeof agentRuns.$inferInsert> = {},
): Promise<RunRow | null> {
  const [run] = await db
    .update(agentRuns)
    .set({ ...extra, status: to, updatedAt: new Date() })
    .where(and(eq(agentRuns.id, runId), inArray(agentRuns.status, allowedFrom(RUN_TRANSITIONS, to))))
    .returning();
  return run ?? null;
}

export async function getStageRow(db: DbExecutor, runId: string, stage: RunStage) {
  const [row] = await db
    .select()
    .from(runStages)
    .where(and(eq(runStages.runId, runId), eq(runStages.stage, stage)))
    .limit(1);
  return row ?? null;
}

export async function stageIsComplete(db: DbExecutor, runId: string, stage: RunStage): Promise<boolean> {
  const row = await getStageRow(db, runId, stage);
  return row?.status === "COMPLETED" || row?.status === "SKIPPED";
}

export async function beginStage(db: DbExecutor, runId: string, stage: RunStage): Promise<void> {
  await db
    .update(runStages)
    .set({
      status: "RUNNING",
      attempts: sql`${runStages.attempts} + 1`,
      startedAt: sql`coalesce(${runStages.startedAt}, now())`,
      error: null,
      updatedAt: new Date(),
    })
    .where(and(eq(runStages.runId, runId), eq(runStages.stage, stage)));
}

export async function completeStage(
  db: DbExecutor,
  runId: string,
  stage: RunStage,
  metrics: Record<string, unknown>,
  status: "COMPLETED" | "SKIPPED" = "COMPLETED",
): Promise<void> {
  await db
    .update(runStages)
    .set({ status, metrics, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(runStages.runId, runId), eq(runStages.stage, stage)));
}

export async function failStage(
  db: DbExecutor,
  runId: string,
  stage: RunStage,
  error: unknown,
): Promise<void> {
  await db
    .update(runStages)
    .set({
      status: "FAILED",
      error: sanitizeErrorMessage(error),
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(runStages.runId, runId), eq(runStages.stage, stage)));
}

/** Records a stage's progress metrics without changing its status (batched stages). */
export async function updateStageMetrics(
  db: DbExecutor,
  runId: string,
  stage: RunStage,
  metrics: Record<string, unknown>,
): Promise<void> {
  await db
    .update(runStages)
    .set({ metrics, updatedAt: new Date() })
    .where(and(eq(runStages.runId, runId), eq(runStages.stage, stage)));
}

export interface RunWarning {
  code: string;
  message: string;
  stage: RunStage;
  at: string;
}

export async function addWarning(
  db: DbExecutor,
  runId: string,
  warning: Omit<RunWarning, "at">,
): Promise<void> {
  const entry: RunWarning = { ...warning, at: new Date().toISOString() };
  await db
    .update(agentRuns)
    .set({ warnings: sql`${agentRuns.warnings} || ${JSON.stringify([entry])}::jsonb` })
    .where(eq(agentRuns.id, runId));
}

export interface RunCounters {
  sourceCount: number;
  hardFilterPassCount: number;
  aiEvaluatedCount: number;
  qualifiedCount: number;
  rejectedCount: number;
  notifiedCount: number;
  failedNotificationCount: number;
  pendingAiCount: number;
  aiErrorCount: number;
  needsReviewCount: number;
  pendingNotificationCount: number;
  uncertainNotificationCount: number;
}

/** Counts derived from the per-job records, which are the source of truth for run metrics. */
export async function computeRunCounters(db: DbExecutor, runId: string): Promise<RunCounters> {
  const [jobs] = await db
    .select({
      total: sql<number>`count(*)::int`,
      passed: sql<number>`count(*) filter (where ${runJobs.passedHardFilters})::int`,
      qualified: sql<number>`count(*) filter (where ${runJobs.processingStatus} = 'QUALIFIED')::int`,
      rejected: sql<number>`count(*) filter (where ${runJobs.processingStatus} in ('FILTERED_OUT', 'REJECTED'))::int`,
      pendingAi: sql<number>`count(*) filter (where ${runJobs.processingStatus} = 'PENDING_AI')::int`,
      aiError: sql<number>`count(*) filter (where ${runJobs.processingStatus} = 'AI_ERROR')::int`,
      review: sql<number>`count(*) filter (where ${runJobs.processingStatus} = 'NEEDS_REVIEW')::int`,
    })
    .from(runJobs)
    .where(eq(runJobs.runId, runId));
  const [evaluated] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(qualifications)
    .where(eq(qualifications.runId, runId));
  const [notes] = await db
    .select({
      sent: sql<number>`count(*) filter (where ${notifications.status} in ('SENT', 'DELIVERED', 'READ'))::int`,
      failed: sql<number>`count(*) filter (where ${notifications.status} in ('FAILED_PERMANENT', 'FAILED_RETRYABLE', 'UNCERTAIN'))::int`,
      pending: sql<number>`count(*) filter (where ${notifications.status} in ('RESERVED', 'SENDING', 'FAILED_RETRYABLE'))::int`,
      uncertain: sql<number>`count(*) filter (where ${notifications.status} = 'UNCERTAIN')::int`,
    })
    .from(notifications)
    .where(eq(notifications.runId, runId));
  return {
    sourceCount: jobs?.total ?? 0,
    hardFilterPassCount: jobs?.passed ?? 0,
    aiEvaluatedCount: evaluated?.count ?? 0,
    qualifiedCount: jobs?.qualified ?? 0,
    rejectedCount: jobs?.rejected ?? 0,
    notifiedCount: notes?.sent ?? 0,
    failedNotificationCount: notes?.failed ?? 0,
    pendingAiCount: jobs?.pendingAi ?? 0,
    aiErrorCount: jobs?.aiError ?? 0,
    needsReviewCount: jobs?.review ?? 0,
    pendingNotificationCount: notes?.pending ?? 0,
    uncertainNotificationCount: notes?.uncertain ?? 0,
  };
}

export async function refreshRunCounters(db: DbExecutor, runId: string): Promise<RunCounters> {
  const counters = await computeRunCounters(db, runId);
  await db
    .update(agentRuns)
    .set({
      sourceCount: counters.sourceCount,
      hardFilterPassCount: counters.hardFilterPassCount,
      aiEvaluatedCount: counters.aiEvaluatedCount,
      qualifiedCount: counters.qualifiedCount,
      rejectedCount: counters.rejectedCount,
      notifiedCount: counters.notifiedCount,
      failedNotificationCount: counters.failedNotificationCount,
      updatedAt: new Date(),
    })
    .where(eq(agentRuns.id, runId));
  return counters;
}

export function isCancelRequested(run: RunRow): boolean {
  return run.cancelRequestedAt !== null;
}
