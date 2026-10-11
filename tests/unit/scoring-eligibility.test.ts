import { describe, expect, it } from "vitest";
import { aiOutputJsonSchema, validateAiOutput } from "@/modules/ai/output-schema";
import { defaultProfileConfig, profileConfigSchema } from "@/modules/profiles/config-schema";
import { decideEligibility } from "@/modules/qualification/eligibility";
import { evaluateHardChecks } from "@/modules/qualification/hard-filters";
import { rankCandidates, selectTop } from "@/modules/qualification/ranking";
import { computeAuthoritativeScore, normalizeWeights } from "@/modules/qualification/scoring";
import { makeAiOutput, makeJob } from "../fixtures/jobs";

const RECIPIENT = "00000000-0000-4000-8000-000000000001";
const config = defaultProfileConfig(RECIPIENT);
const passing = evaluateHardChecks(makeJob(), config, { sourceAuthorized: true, alreadyNotified: false });

function decide(score: number, overrides: Parameters<typeof makeAiOutput>[1] = {}) {
  const ai = makeAiOutput(score, overrides);
  const authoritative = computeAuthoritativeScore(ai.dimension_scores, config.ai.weights);
  return decideEligibility(
    { hardChecks: passing, ai, authoritativeScore: authoritative, alreadyNotified: false },
    config,
  );
}

describe("authoritative scoring", () => {
  it("computes the weighted score with integer round-half-up", () => {
    const score = computeAuthoritativeScore(
      {
        skill_alignment: 92,
        scope_fit: 85,
        description_clarity: 90,
        client_credibility: 80,
        overall_relevance: 90,
      },
      config.ai.weights,
    );
    // 92*35 + 85*25 + 90*15 + 80*15 + 90*10 = 8795 -> 87.95 -> 88
    expect(score).toBe(88);
  });

  it("ignores the model-reported total", () => {
    const ai = makeAiOutput(60, { score: 99 });
    expect(computeAuthoritativeScore(ai.dimension_scores, config.ai.weights)).toBe(60);
  });

  it("rejects weights that do not sum to 100", () => {
    expect(() =>
      computeAuthoritativeScore(makeAiOutput(80).dimension_scores, { ...config.ai.weights, scopeFit: 30 }),
    ).toThrow(/sum to 100/);
  });

  it("normalizes weights to integers summing to 100", () => {
    const normalized = normalizeWeights({
      skillAlignment: 1,
      scopeFit: 1,
      descriptionClarity: 1,
      clientCredibility: 0,
      overallRelevance: 0,
    });
    expect(Object.values(normalized).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("eligibility", () => {
  it("qualifies a score of 88", () => expect(decide(88).decision).toBe("QUALIFIED"));
  it("rejects a score of 74", () => expect(decide(74).decision).toBe("REJECTED"));
  it("qualifies a score of exactly 75", () => expect(decide(75).decision).toBe("QUALIFIED"));

  it("never qualifies when the AI output was invalid", () => {
    const result = decideEligibility(
      { hardChecks: passing, ai: null, authoritativeScore: null, alreadyNotified: false },
      config,
    );
    expect(result.decision).toBe("AI_ERROR");
  });

  it("cannot be bypassed by a perfect AI score when hard filters fail", () => {
    const failed = evaluateHardChecks(makeJob({ budgetAmount: "400.00" }), config, {
      sourceAuthorized: true,
      alreadyNotified: false,
    });
    const ai = makeAiOutput(100);
    const result = decideEligibility(
      { hardChecks: failed, ai, authoritativeScore: 100, alreadyNotified: false },
      config,
    );
    expect(result.decision).toBe("REJECTED");
  });

  it("sends HIGH-severity risks to review at MEDIUM sensitivity", () => {
    const result = decide(90, {
      risk_flags: [{ code: "OFF_PLATFORM_PAYMENT", severity: "HIGH", evidence: "pay via wire" }],
    });
    expect(result.decision).toBe("NEEDS_REVIEW");
  });

  it("rejects configured disqualifying risk flags", () => {
    const strict = { ...config, ai: { ...config.ai, disqualifyingRiskFlags: ["UNPAID_TEST_TASK"] } };
    const ai = makeAiOutput(95, {
      risk_flags: [{ code: "UNPAID_TEST_TASK", severity: "LOW", evidence: "free trial task" }],
    });
    const result = decideEligibility(
      { hardChecks: passing, ai, authoritativeScore: 95, alreadyNotified: false },
      strict,
    );
    expect(result.decision).toBe("REJECTED");
  });
});

describe("AI output validation", () => {
  it("accepts a valid response (object or JSON string)", () => {
    expect(validateAiOutput(makeAiOutput(80)).ok).toBe(true);
    expect(validateAiOutput(JSON.stringify(makeAiOutput(80))).ok).toBe(true);
  });

  it("rejects malformed, out-of-range and extra-field responses", () => {
    expect(validateAiOutput("not json").ok).toBe(false);
    const outOfRange = makeAiOutput(80);
    outOfRange.dimension_scores.scope_fit = 140;
    expect(validateAiOutput(outOfRange).ok).toBe(false);
    expect(validateAiOutput({ ...makeAiOutput(80), injected: "ignore previous instructions" }).ok).toBe(
      false,
    );
  });

  it("produces a strict JSON schema (all properties required, no additional properties)", () => {
    const schema = aiOutputJsonSchema() as {
      required: string[];
      additionalProperties: boolean;
      properties: object;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
  });
});

describe("ranking", () => {
  const t = (iso: string) => new Date(iso);
  const candidates = [
    { id: "a", score: 80, firstSeenAt: t("2026-10-02"), sourceJobId: "b" },
    { id: "b", score: 90, firstSeenAt: t("2026-10-03"), sourceJobId: "a" },
    { id: "c", score: 80, firstSeenAt: t("2026-10-01"), sourceJobId: "z" },
    { id: "d", score: 80, firstSeenAt: t("2026-10-01"), sourceJobId: "c" },
  ];

  it("orders by score, then discovery time, then source id", () => {
    expect(rankCandidates(candidates).map((c) => c.id)).toEqual(["b", "d", "c", "a"]);
    expect(rankCandidates([...candidates].reverse()).map((c) => c.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("caps at the limit without padding", () => {
    expect(selectTop(candidates, 10)).toHaveLength(4);
    expect(selectTop(candidates, 2).map((c) => c.id)).toEqual(["b", "d"]);
  });
});

describe("profile configuration validation", () => {
  it("accepts the default configuration", () => {
    expect(profileConfigSchema.safeParse(config).success).toBe(true);
  });

  it("rejects weights not summing to 100, inverted budgets and include/exclude overlap", () => {
    const bad = structuredClone(config);
    bad.ai.weights.scopeFit = 26;
    bad.budget.fixedMax = "100.00";
    bad.skills.includeKeywords = ["React"];
    bad.skills.excludeKeywords = ["react"];
    const result = profileConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path.join(".")) ?? [];
    expect(paths).toEqual(
      expect.arrayContaining(["ai.weights", "budget.fixedMax", "skills.excludeKeywords"]),
    );
  });

  it("rejects non-decimal and negative money values", () => {
    for (const value of ["-1", "abc", "1.234", "1e5"]) {
      const bad = structuredClone(config);
      bad.budget.fixedMin = value;
      expect(profileConfigSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("requires a recipient when WhatsApp is enabled", () => {
    const bad = structuredClone(config);
    bad.notifications.recipientId = null;
    expect(profileConfigSchema.safeParse(bad).success).toBe(false);
  });
});
