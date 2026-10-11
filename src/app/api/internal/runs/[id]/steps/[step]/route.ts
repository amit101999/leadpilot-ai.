import { z } from "zod";
import { internalRoute, parseJsonText } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { getProviders } from "@/modules/providers";
import { runStep, STAGE_STEPS } from "@/modules/runs/engine";

const stepParam = z.enum(STAGE_STEPS);
/** The n8n execution id is the lease owner, so two n8n executions cannot process one run at once. */
const body = z.object({ executionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });

/**
 * n8n orchestration: executes one idempotent pipeline step and returns the
 * next step to call (or `terminal: true`). Signed with INTERNAL_API_SECRET.
 */
export const POST = internalRoute(async ({ db, params, rawBody }) => {
  const runId = uuidParam.parse(params.id);
  const step = stepParam.parse(params.step);
  const { executionId } = parseJsonText(rawBody, body);
  return runStep(db, getProviders(), runId, step, `n8n:${executionId}`);
});
