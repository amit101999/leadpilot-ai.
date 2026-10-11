import { and, asc, eq, sql } from "drizzle-orm";
import { env } from "@/lib/configuration/env";
import { jobs, qualifications, runJobs } from "@/lib/database/schema";
import { sanitizeErrorMessage } from "@/lib/security/sanitize";
import { AiProviderError, hashEvaluationInput, toEvaluationProfile } from "@/modules/ai/evaluator";
import { validateAiOutput, type AiOutput } from "@/modules/ai/output-schema";
import { rowToNormalized, type JobRow } from "@/modules/jobs/repository";
import { decideEligibility } from "@/modules/qualification/eligibility";
import type { HardCheckResult } from "@/modules/qualification/hard-filters";
import { computeAuthoritativeScore } from "@/modules/qualification/scoring";
import {
  beginStage,
  completeStage,
  refreshRunCounters,
  updateStageMetrics,
  type RunContext,
  type StageResponse,
} from "./context";
import { alreadyNotifiedJobIds } from "./filtering";
import { gate, respond } from "./gating";

type RunJobRow = typeof runJobs.$inferSelect;

/**
 * AI_EVALUATION: processes one bounded batch per call so no request (and no
 * transaction) spans many slow model calls. Returns `remaining`; the executor
 * calls again until it reaches 0.
 */
export async function evaluateStep(ctx: RunContext): Promise<StageResponse> {
  const blocked = await gate(ctx, "evaluate");
  if (blocked) return blocked;
  const { db, run } = ctx;
  const config = env();
  await beginStage(db, run.id, "AI_EVALUATION");

  const batch = await db
    .select({ runJob: runJobs, job: jobs })
    .from(runJobs)
    .innerJoin(jobs, eq(jobs.id, runJobs.jobId))
    .where(and(eq(runJobs.runId, run.id), eq(runJobs.processingStatus, "PENDING_AI")))
    .orderBy(asc(runJobs.createdAt), asc(runJobs.id))
    .limit(config.AI_BATCH_SIZE);

  await mapWithConcurrency(batch, config.AI_CONCURRENCY, ({ runJob, job }) => evaluateOne(ctx, runJob, job));

  const [pending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(runJobs)
    .where(and(eq(runJobs.runId, run.id), eq(runJobs.processingStatus, "PENDING_AI")));
  const remaining = pending?.count ?? 0;
  const counters = await refreshRunCounters(db, run.id);
  const metrics = { evaluated: counters.aiEvaluatedCount, aiErrors: counters.aiErrorCount, remaining };

  if (remaining > 0) {
    await updateStageMetrics(db, run.id, "AI_EVALUATION", metrics);
    return respond(ctx, "evaluate", "evaluate", { remaining });
  }
  await completeStage(db, run.id, "AI_EVALUATION", metrics);
  return respond(ctx, "evaluate", "select", { remaining: 0 });
}

async function evaluateOne(ctx: RunContext, runJob: RunJobRow, jobRow: JobRow): Promise<void> {
  const { db, run, snapshot, providers } = ctx;
  const config = snapshot.configuration;
  const evaluator = providers.ai;
  const input = { job: rowToNormalized(jobRow), profile: toEvaluationProfile(config) };
  const maxAttempts = 1 + config.ai.maxRetries;

  let output: AiOutput | null = null;
  let lastError: string | null = null;
  let attempts = 0;
  // Invalid output and transient provider errors are retried a bounded number of times.
  while (attempts < maxAttempts && !output) {
    attempts += 1;
    try {
      const validation = validateAiOutput(await evaluator.evaluate(input));
      if (validation.ok) output = validation.value;
      else lastError = validation.error;
    } catch (error) {
      lastError = sanitizeErrorMessage(error);
      if (error instanceof AiProviderError && error.kind === "NOT_CONFIGURED") break;
    }
  }

  const score = output ? computeAuthoritativeScore(output.dimension_scores, config.ai.weights) : null;
  const notified = await alreadyNotifiedJobIds(db, config, [jobRow.id]);
  const decision = decideEligibility(
    {
      hardChecks: {
        status: "PENDING_AI",
        results: runJob.hardCheckResults as HardCheckResult[],
        rejectionReasons: [],
        skillMatches: [],
      },
      ai: output,
      authoritativeScore: score,
      alreadyNotified: notified.has(jobRow.id),
    },
    config,
  );

  const qualification = {
    runId: run.id,
    jobId: jobRow.id,
    score,
    modelReportedScore: output?.score ?? null,
    dimensionScores: output?.dimension_scores ?? null,
    decision: decision.decision,
    decisionReasons: decision.reasons,
    promptVersion: snapshot.promptVersion,
    rubricVersion: snapshot.rubricVersion,
    modelIdentifier: `${evaluator.id}:${evaluator.model}`,
    inputHash: hashEvaluationInput(input, snapshot.promptVersion),
    evidence: output
      ? {
          dimensionDetails: output.dimension_details,
          skillMatches: output.skill_matches,
          scopeSummary: output.scope_summary,
          positiveSignals: output.positive_signals,
          reasoningSummary: output.reasoning_summary,
        }
      : {},
    riskFlags: output?.risk_flags ?? [],
    missingInformation: output?.missing_information ?? [],
    attempts,
    error: output ? null : lastError,
    evaluatedAt: new Date(),
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(qualifications)
      .values(qualification)
      .onConflictDoUpdate({ target: [qualifications.runId, qualifications.jobId], set: qualification });
    await tx
      .update(runJobs)
      .set({
        processingStatus: decision.decision,
        rejectionReasons: decision.decision === "QUALIFIED" ? [] : decision.reasons,
        aiAttempts: attempts,
        updatedAt: new Date(),
      })
      .where(and(eq(runJobs.id, runJob.id), eq(runJobs.processingStatus, "PENDING_AI")));
  });
  ctx.log.info(
    { job_id: jobRow.id, workflow_stage: "AI_EVALUATION", decision: decision.decision, score, attempts },
    "Job evaluated",
  );
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++]!;
      await worker(item);
    }
  });
  await Promise.all(runners);
}
