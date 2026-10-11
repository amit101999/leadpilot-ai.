import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/database/client";
import { logger } from "@/lib/logging/logger";
import type { Providers } from "@/modules/providers";
import { enterRun, STEP_TO_STAGE, terminalResponse, type StageResponse, type StageStep } from "./context";
import { notifyStep } from "./delivery";
import { discoverStep, startStep } from "./discovery";
import { evaluateStep } from "./evaluation";
import { failRun, finalizeStep } from "./finalization";
import { filterStep } from "./filtering";
import { selectStep } from "./selection";

export { failRun } from "./finalization";
export { STAGE_STEPS, type StageResponse, type StageStep } from "./context";

const STEPS = {
  start: startStep,
  discover: discoverStep,
  filter: filterStep,
  evaluate: evaluateStep,
  select: selectStep,
  notify: notifyStep,
  finalize: finalizeStep,
} satisfies Record<StageStep, unknown>;

/**
 * Executes one pipeline step for a run. This is the single entry point used
 * by both executors (n8n via the internal HTTP API, and the in-process runner).
 */
export async function runStep(
  db: Database,
  providers: Providers,
  runId: string,
  step: StageStep,
  executorId: string,
): Promise<StageResponse> {
  const ctx = await enterRun(db, runId, executorId, providers);
  if (!("snapshot" in ctx)) return terminalResponse(ctx, step);
  return STEPS[step](ctx);
}

const MAX_STEP_ATTEMPTS = 3;
const MAX_STEPS = 10_000;

/**
 * In-process executor: drives the same steps sequentially with bounded
 * per-step retries, then fails the run if a step keeps failing. Used in tests,
 * local development and as an explicit fallback (RUN_EXECUTOR=inprocess).
 */
export async function runInProcess(
  db: Database,
  providers: Providers,
  runId: string,
  options: { sleep?: (ms: number) => Promise<void>; executorId?: string } = {},
): Promise<StageResponse> {
  const executorId = options.executorId ?? `inprocess:${randomUUID()}`;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = logger.child({ run_id: runId, executor: executorId });
  let step: StageStep = "start";
  let last: StageResponse | null = null;

  for (let iteration = 0; iteration < MAX_STEPS; iteration++) {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        last = await runStep(db, providers, runId, step, executorId);
        break;
      } catch (error) {
        log.warn({ workflow_stage: STEP_TO_STAGE[step], attempt, err: error }, "Run step failed");
        if (attempt >= MAX_STEP_ATTEMPTS) {
          const failed = await failRun(db, providers, runId, { stage: STEP_TO_STAGE[step], error });
          return { runId, step, runStatus: failed.status, terminal: true, next: null };
        }
        await sleep(500 * 2 ** (attempt - 1));
      }
    }
    if (last.terminal || !last.next) return last;
    if (last.retryAfterMs && last.retryAfterMs > 0) await sleep(Math.min(last.retryAfterMs, 60_000));
    step = last.next;
  }
  throw new Error(`Run ${runId} exceeded the maximum number of steps`);
}
