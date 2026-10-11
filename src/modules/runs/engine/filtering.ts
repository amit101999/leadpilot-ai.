import { and, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "@/lib/database/client";
import { jobs, notifications, runJobs, runStages } from "@/lib/database/schema";
import { rowToNormalized } from "@/modules/jobs/repository";
import { CLAIMED_NOTIFICATION_STATUSES } from "@/modules/notifications/transitions";
import type { ProfileConfig } from "@/modules/profiles/config-schema";
import { evaluateHardChecks } from "@/modules/qualification/hard-filters";
import {
  beginStage,
  completeStage,
  refreshRunCounters,
  type RunContext,
  type StageResponse,
} from "./context";
import { gate, respond } from "./gating";

/**
 * HARD_FILTERS: deterministic mandatory rules. Runs in one transaction with no
 * external calls, so it either fully applies or not at all.
 */
export async function filterStep(ctx: RunContext): Promise<StageResponse> {
  const blocked = await gate(ctx, "filter");
  if (blocked) return blocked;
  const { db, run, snapshot } = ctx;
  const config = snapshot.configuration;
  await beginStage(db, run.id, "HARD_FILTERS");

  const sourceCheck = await db
    .select({ metrics: runStages.metrics })
    .from(runStages)
    .where(and(eq(runStages.runId, run.id), eq(runStages.stage, "SOURCE_CHECK")))
    .limit(1);
  const sourceState = (sourceCheck[0]?.metrics as { state?: string } | undefined)?.state;
  const sourceAuthorized = sourceState === "CONNECTED" || sourceState === "MOCK";

  const metrics = await db.transaction(async (tx) => {
    const pending = await tx
      .select({ runJob: runJobs, job: jobs })
      .from(runJobs)
      .innerJoin(jobs, eq(jobs.id, runJobs.jobId))
      .where(and(eq(runJobs.runId, run.id), eq(runJobs.processingStatus, "NEW")))
      .for("update", { of: runJobs });

    const notified = await alreadyNotifiedJobIds(
      tx,
      config,
      pending.map((p) => p.job.id),
    );

    const counts = { evaluated: pending.length, passed: 0, filteredOut: 0, needsReview: 0, capped: 0 };
    const passing: Array<{ runJobId: string; postedAt: Date | null; sourceJobId: string }> = [];

    for (const { runJob, job } of pending) {
      const summary = evaluateHardChecks(rowToNormalized(job), config, {
        sourceAuthorized,
        alreadyNotified: notified.has(job.id),
      });
      const passed = summary.status === "PENDING_AI";
      await tx
        .update(runJobs)
        .set({
          processingStatus: summary.status,
          passedHardFilters: passed,
          hardCheckResults: summary.results,
          rejectionReasons: summary.rejectionReasons,
          updatedAt: new Date(),
        })
        .where(and(eq(runJobs.id, runJob.id), eq(runJobs.processingStatus, "NEW")));
      if (passed) {
        counts.passed += 1;
        passing.push({ runJobId: runJob.id, postedAt: job.postedAt, sourceJobId: job.sourceJobId });
      } else if (summary.status === "FILTERED_OUT") counts.filteredOut += 1;
      else counts.needsReview += 1;
    }

    // Optional cost cap on AI evaluations: newest postings first; the rest are parked for review.
    const cap = config.general.maxJobsToEvaluate;
    if (cap !== null && passing.length > cap) {
      const ordered = [...passing].sort(
        (a, b) =>
          (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0) || a.sourceJobId.localeCompare(b.sourceJobId),
      );
      const overflow = ordered.slice(cap).map((p) => p.runJobId);
      counts.capped = overflow.length;
      await tx
        .update(runJobs)
        .set({
          processingStatus: "NEEDS_REVIEW",
          rejectionReasons: [`Not evaluated: per-run AI evaluation limit of ${cap} reached`],
          updatedAt: new Date(),
        })
        .where(and(inArray(runJobs.id, overflow), eq(runJobs.processingStatus, "PENDING_AI")));
    }
    return counts;
  });

  await completeStage(db, run.id, "HARD_FILTERS", metrics);
  await refreshRunCounters(db, run.id);
  return respond(ctx, "filter", "evaluate");
}

/** Jobs that already hold an active or delivered claim for the profile's recipient. */
export async function alreadyNotifiedJobIds(
  db: DbExecutor,
  config: ProfileConfig,
  jobIds: string[],
): Promise<Set<string>> {
  const recipientId = config.notifications.recipientId;
  if (!config.notifications.whatsappEnabled || !recipientId || jobIds.length === 0) return new Set();
  const rows = await db
    .select({ jobId: notifications.jobId })
    .from(notifications)
    .where(
      and(
        inArray(notifications.jobId, jobIds),
        eq(notifications.channel, "WHATSAPP"),
        eq(notifications.recipientId, recipientId),
        inArray(notifications.status, [...CLAIMED_NOTIFICATION_STATUSES]),
      ),
    );
  return new Set(rows.map((r) => r.jobId));
}
