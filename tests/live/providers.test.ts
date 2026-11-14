import "dotenv/config";
import { describe, expect, it } from "vitest";
import { OpenAiEvaluator } from "@/modules/ai/openai-evaluator";
import { validateAiOutput } from "@/modules/ai/output-schema";
import { makeJob } from "../fixtures/jobs";

/**
 * Opt-in checks against the real services, using the credentials in .env:
 *
 *   LIVE_TESTS=1 npx vitest run --project live        (PowerShell: $env:LIVE_TESTS=1; npx vitest run --project live)
 *
 * They cost at most one small OpenAI request and send no e-mail.
 */
const live = process.env.LIVE_TESTS === "1";
const env = process.env;

describe.skipIf(!live || !env.OPENAI_API_KEY || !env.OPENAI_MODEL)("OpenAI (live)", () => {
  const evaluator = new OpenAiEvaluator(env.OPENAI_API_KEY, env.OPENAI_MODEL, 30_000);

  it("accepts the key and finds the configured model", async () => {
    expect(await evaluator.checkConnection()).toMatchObject({ state: "CONNECTED" });
  });

  it("returns output that passes the strict schema for a sample job", async () => {
    const raw = await evaluator.evaluate({
      job: makeJob(),
      profile: {
        requiredSkills: ["React", "Node.js"],
        optionalSkills: [],
        category: null,
        riskSensitivity: "MEDIUM",
      },
    });
    const result = validateAiOutput(raw);
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
  });
});
