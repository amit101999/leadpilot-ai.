import { asc, eq } from "drizzle-orm";
import type { DbExecutor } from "@/lib/database/client";
import { runStages } from "@/lib/database/schema";
import { RUN_STAGES } from "@/types/domain";
import { STAGE_STEPS, STEP_TO_STAGE, type RunContext, type StageResponse, type StageStep } from "./context";

const STAGE_TO_STEP = Object.fromEntries(STAGE_STEPS.map((step) => [STEP_TO_STAGE[step], step])) as Record<
  (typeof RUN_STAGES)[number],
  StageStep
>;

export async function firstIncompleteStep(db: DbExecutor, runId: string): Promise<StageStep> {
  const rows = await db.select().from(runStages).where(eq(runStages.runId, runId)).orderBy(asc(runStages.stage));
  const byStage = new Map(rows.map((r) => [r.stage, r.status]));
  for (const stage of RUN_STAGES) {
    const status = byStage.get(stage);
    if (status !== "COMPLETED" && status !== "SKIPPED") return STAGE_TO_STEP[stage];
  }
  return "finalize";
}

export function respond(ctx: RunContext, step: StageStep, next: StageStep, extra: Partial<StageResponse> = {}) {
  return {
    runId: ctx.run.id,
    step,
    runStatus: ctx.run.status,
    terminal: false,
    next,
    ...extra,
  } satisfies StageResponse;
}

/**
 * Ensures steps run in order and are idempotent. Returns a redirect response
 * when this step should not run now (cancelled, out of order, already done),
 * or null when the caller should proceed.
 */
export async function gate(ctx: RunContext, step: StageStep): Promise<StageResponse | null> {
  if (step !== "finalize" && ctx.run.cancelRequestedAt) {
    return respond(ctx, step, "finalize", { message: "Cancellation requested" });
  }
  const expected = await firstIncompleteStep(ctx.db, ctx.run.id);
  const order = STAGE_STEPS.indexOf(step);
  const expectedOrder = STAGE_STEPS.indexOf(expected);
  if (order > expectedOrder) {
    return respond(ctx, step, expected, { message: `Step ${expected} must complete first` });
  }
  if (order < expectedOrder) {
    return respond(ctx, step, expected, { message: `Step ${step} already completed` });
  }
  return null;
}
