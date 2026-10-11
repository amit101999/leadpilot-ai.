import type { TransitionMap } from "@/lib/state-machine";
import type { JobProcessingStatus, RunStatus } from "@/types/domain";

export const RUN_TRANSITIONS: TransitionMap<RunStatus> = {
  QUEUED: ["RUNNING", "FAILED", "CANCELLED", "BLOCKED_SOURCE"],
  RUNNING: ["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED", "BLOCKED_SOURCE"],
  COMPLETED: [],
  COMPLETED_WITH_ERRORS: [],
  FAILED: [],
  CANCELLED: [],
  BLOCKED_SOURCE: [],
};

/**
 * Per-run job processing. PENDING_AI may be re-entered on resume (evaluation
 * is idempotent per run+job), so it is not listed as its own successor.
 */
export const RUN_JOB_TRANSITIONS: TransitionMap<JobProcessingStatus> = {
  NEW: ["FILTERED_OUT", "PENDING_AI", "NEEDS_REVIEW", "SOURCE_ERROR"],
  PENDING_AI: ["QUALIFIED", "REJECTED", "NEEDS_REVIEW", "AI_ERROR"],
  // A qualified job can still be demoted at selection time (e.g. a concurrent run claimed it first).
  QUALIFIED: ["REJECTED"],
  FILTERED_OUT: [],
  REJECTED: [],
  NEEDS_REVIEW: [],
  AI_ERROR: [],
  SOURCE_ERROR: [],
};
