import { z } from "zod";
import { runStage } from "@/lib/database/schema";
import { internalRoute, parseJsonText } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { getProviders } from "@/modules/providers";
import { failRun } from "@/modules/runs/engine";

const body = z.object({
  stage: z.enum(runStage.enumValues).nullable().optional(),
  error: z.string().max(2000),
  executionId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
});

/**
 * Called by the n8n error workflow. Marks the run FAILED (message sanitised)
 * while keeping every job, qualification and notification already recorded.
 */
export const POST = internalRoute(async ({ db, params, rawBody }) => {
  const runId = uuidParam.parse(params.id);
  const input = parseJsonText(rawBody, body);
  const run = await failRun(db, getProviders(), runId, {
    stage: input.stage ?? null,
    error: input.error,
    executionId: input.executionId ?? null,
  });
  return { runId: run.id, status: run.status };
});
