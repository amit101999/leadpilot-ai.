import { and, eq, inArray } from "drizzle-orm";
import {
  integrationStatus,
  notificationAttempts,
  notifications,
  runJobs,
  runStages,
} from "@/lib/database/schema";
import { AppError } from "@/lib/http/errors";
import { sanitizeErrorMessage } from "@/lib/security/sanitize";
import { upsertJob } from "@/modules/jobs/repository";
import { SourceNotAuthorizedError } from "@/modules/job-sources/types";
import {
  addWarning,
  beginStage,
  completeStage,
  failStage,
  refreshRunCounters,
  transitionRun,
  updateStageMetrics,
  type RunContext,
  type StageResponse,
} from "./context";
import { gate, respond } from "./gating";

const MAX_PAGES = 20;
const MAX_JOBS = 500;

/** SOURCE_CHECK: marks the run RUNNING, reconciles crashed sends, verifies source authorization. */
export async function startStep(ctx: RunContext): Promise<StageResponse> {
  const { db, run } = ctx;
  if (run.status === "QUEUED") {
    const started = await transitionRun(db, run.id, "RUNNING", { startedAt: new Date() });
    if (started) ctx.run = started;
  }
  await reconcileInterruptedSends(ctx);

  const blocked = await gate(ctx, "start");
  if (blocked) return blocked;

  await beginStage(db, run.id, "SOURCE_CHECK");
  const provider = ctx.providers.jobSource;
  if (provider.id !== ctx.snapshot.providers.jobSource) {
    // Never silently substitute a different source than the one recorded for this run.
    const message = `Configured job source changed from "${ctx.snapshot.providers.jobSource}" to "${provider.id}" after the run was created`;
    await failStage(db, run.id, "SOURCE_CHECK", message);
    return blockRun(ctx, "SOURCE_MISMATCH", message);
  }

  const connection = await provider.checkConnection();
  await db
    .insert(integrationStatus)
    .values({
      provider: "job_source",
      status: connection.state,
      lastCheckedAt: new Date(),
      lastSuccessAt: connection.state === "CONNECTED" || connection.state === "MOCK" ? new Date() : null,
      sanitizedError:
        connection.state === "CONNECTED" || connection.state === "MOCK" ? null : connection.message,
      metadata: { provider: provider.id, missing: connection.missing ?? [] },
    })
    .onConflictDoUpdate({
      target: integrationStatus.provider,
      set: {
        status: connection.state,
        lastCheckedAt: new Date(),
        sanitizedError:
          connection.state === "CONNECTED" || connection.state === "MOCK" ? null : connection.message,
        metadata: { provider: provider.id, missing: connection.missing ?? [] },
        updatedAt: new Date(),
      },
    });

  if (connection.state === "NOT_AUTHORIZED" || connection.state === "NOT_CONFIGURED") {
    await failStage(db, run.id, "SOURCE_CHECK", connection.message);
    return blockRun(ctx, "SOURCE_NOT_AUTHORIZED", connection.message);
  }
  if (connection.state === "UNAVAILABLE") {
    // Transient: the executor retries this step, then fails the run if it persists.
    await failStage(db, run.id, "SOURCE_CHECK", connection.message);
    throw new AppError("SOURCE_UNAVAILABLE", connection.message);
  }

  await completeStage(db, run.id, "SOURCE_CHECK", {
    state: connection.state,
    message: connection.message,
    isMock: provider.getCapabilities().isMock,
  });
  return respond(ctx, "start", "discover");
}

/** DISCOVERY: pages through the source, normalizes, upserts jobs and links them to the run (deduplicated). */
export async function discoverStep(ctx: RunContext): Promise<StageResponse> {
  const blocked = await gate(ctx, "discover");
  if (blocked) return blocked;
  const { db, run } = ctx;
  await beginStage(db, run.id, "DISCOVERY");

  const provider = ctx.providers.jobSource;
  let cursor: string | null = null;
  let pages = 0;
  let received = 0;
  let invalid = 0;
  let duplicatesInRun = 0;
  let linked = 0;
  let truncated = false;

  try {
    do {
      const page = await provider.discoverJobs(ctx.snapshot.configuration, cursor);
      pages += 1;
      for (const record of page.records) {
        received += 1;
        if (linked >= MAX_JOBS) {
          truncated = true;
          break;
        }
        const job = provider.normalizeJob(record);
        if (!job) {
          invalid += 1;
          continue;
        }
        const stored = await upsertJob(db, job);
        const inserted = await db
          .insert(runJobs)
          .values({
            runId: run.id,
            jobId: stored.id,
            // Seen before this run started (robust to a resumed discovery step).
            previouslySeen: stored.firstSeenAt.getTime() < run.createdAt.getTime(),
          })
          .onConflictDoNothing({ target: [runJobs.runId, runJobs.jobId] })
          .returning({ id: runJobs.id });
        if (inserted.length > 0) linked += 1;
        else duplicatesInRun += 1;
      }
      cursor = page.nextCursor;
      await updateStageMetrics(db, run.id, "DISCOVERY", {
        pages,
        received,
        linked,
        invalid,
        duplicatesInRun,
      });
    } while (cursor && pages < MAX_PAGES && !truncated);
  } catch (error) {
    if (error instanceof SourceNotAuthorizedError) {
      await failStage(db, run.id, "DISCOVERY", error.message);
      return blockRun(ctx, "SOURCE_NOT_AUTHORIZED", error.message);
    }
    await failStage(db, run.id, "DISCOVERY", error);
    throw error;
  }

  if (invalid > 0) {
    await addWarning(db, run.id, {
      code: "INVALID_SOURCE_RECORDS",
      stage: "DISCOVERY",
      message: `${invalid} source record(s) could not be normalized and were skipped`,
    });
  }
  if (truncated || (cursor && pages >= MAX_PAGES)) {
    await addWarning(db, run.id, {
      code: "DISCOVERY_LIMIT_REACHED",
      stage: "DISCOVERY",
      message: `Discovery stopped at the safety limit (${MAX_PAGES} pages / ${MAX_JOBS} jobs)`,
    });
  }
  await completeStage(db, run.id, "DISCOVERY", {
    pages,
    received,
    linked,
    invalid,
    duplicatesInRun,
    truncated,
  });
  await refreshRunCounters(db, run.id);
  return respond(ctx, "discover", "filter");
}

/** Stops a run whose source is not authorized. Partial data is preserved; later stages are skipped. */
async function blockRun(ctx: RunContext, code: string, message: string): Promise<StageResponse> {
  const { db, run } = ctx;
  const blocked = await transitionRun(db, run.id, "BLOCKED_SOURCE", {
    finishedAt: new Date(),
    leaseOwner: null,
    leaseExpiresAt: null,
    errorSummary: { code, message: sanitizeErrorMessage(message), stage: "SOURCE_CHECK" },
  });
  await db
    .update(runStages)
    .set({ status: "SKIPPED", updatedAt: new Date() })
    .where(and(eq(runStages.runId, run.id), inArray(runStages.status, ["PENDING"])));
  const finalRun = blocked ?? run;
  return { runId: run.id, step: "start", runStatus: finalRun.status, terminal: true, next: null, message };
}

/**
 * After a crash, a notification left in SENDING may or may not have reached
 * the provider. It becomes UNCERTAIN and is never retried automatically.
 */
async function reconcileInterruptedSends(ctx: RunContext): Promise<void> {
  const { db, run } = ctx;
  const stuck = await db
    .update(notifications)
    .set({
      status: "UNCERTAIN",
      lastError: "Executor stopped during send; delivery unknown",
      updatedAt: new Date(),
    })
    .where(and(eq(notifications.runId, run.id), eq(notifications.status, "SENDING")))
    .returning({ id: notifications.id });
  for (const row of stuck) {
    await db
      .update(notificationAttempts)
      .set({ outcome: "UNCERTAIN", error: "Executor stopped during send", finishedAt: new Date() })
      .where(
        and(eq(notificationAttempts.notificationId, row.id), eq(notificationAttempts.outcome, "SENDING")),
      );
  }
  if (stuck.length > 0) {
    await addWarning(db, run.id, {
      code: "INTERRUPTED_SENDS",
      stage: "NOTIFICATION",
      message: `${stuck.length} notification(s) were interrupted mid-send and marked UNCERTAIN`,
    });
  }
}
