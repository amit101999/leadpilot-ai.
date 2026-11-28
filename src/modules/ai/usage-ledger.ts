import type { DbExecutor } from "@/lib/database/client";
import { aiCalls } from "@/lib/database/schema";
import type { childLogger } from "@/lib/logging/logger";
import { sanitizeErrorMessage } from "@/lib/security/sanitize";
import type { AiCallStatus } from "@/types/domain";
import { AiProviderError, type AiUsage } from "./evaluator";
import { estimateCostMicroUsd } from "./pricing";

export interface AiCallRecord {
  runId: string | null;
  jobId: string | null;
  profileId: string | null;
  provider: string;
  /** Configured model, used when the provider reported no usage (failed call or mock). */
  configuredModel: string;
  promptVersion: string;
  attempt: number;
  status: AiCallStatus;
  httpStatus: number | null;
  latencyMs: number;
  usage: AiUsage | null;
}

/** Status for a call that threw. Configuration and unknown errors count as provider errors. */
export function statusForError(error: unknown): { status: AiCallStatus; httpStatus: number | null } {
  if (!(error instanceof AiProviderError)) return { status: "PROVIDER_ERROR", httpStatus: null };
  const status: AiCallStatus =
    error.kind === "TIMEOUT" ? "TIMEOUT" : error.kind === "RATE_LIMIT" ? "RATE_LIMIT" : "PROVIDER_ERROR";
  return { status, httpStatus: error.httpStatus };
}

/**
 * Appends one row to the usage ledger. Best-effort by design: usage reporting
 * must never change the outcome of an evaluation, so a failed insert is logged
 * as a warning and swallowed.
 */
export async function recordAiCall(
  db: DbExecutor,
  record: AiCallRecord,
  log: ReturnType<typeof childLogger>,
): Promise<void> {
  const usage = record.usage;
  try {
    await db.insert(aiCalls).values({
      runId: record.runId,
      jobId: record.jobId,
      profileId: record.profileId,
      provider: record.provider,
      model: usage?.model || record.configuredModel,
      promptVersion: record.promptVersion,
      attempt: record.attempt,
      status: record.status,
      httpStatus: record.httpStatus,
      latencyMs: Math.max(0, Math.round(record.latencyMs)),
      inputTokens: usage?.inputTokens ?? null,
      cachedInputTokens: usage?.cachedInputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      reasoningTokens: usage?.reasoningTokens ?? null,
      costMicroUsd: usage ? estimateCostMicroUsd(usage) : null,
    });
  } catch (error) {
    log.warn(
      { job_id: record.jobId, workflow_stage: "AI_EVALUATION", error: sanitizeErrorMessage(error) },
      "Failed to record AI usage",
    );
  }
}
