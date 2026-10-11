import { describe, expect, it } from "vitest";
import { evaluateHardChecks, type HardRule } from "@/modules/qualification/hard-filters";
import { defaultProfileConfig, type ProfileConfig } from "@/modules/profiles/config-schema";
import { makeJob } from "../fixtures/jobs";

const RECIPIENT = "00000000-0000-4000-8000-000000000001";
const context = { sourceAuthorized: true, alreadyNotified: false };

function config(mutate?: (c: ProfileConfig) => void): ProfileConfig {
  const c = defaultProfileConfig(RECIPIENT);
  mutate?.(c);
  return c;
}

function rule(summary: ReturnType<typeof evaluateHardChecks>, name: HardRule) {
  const found = summary.results.find((r) => r.rule === name);
  if (!found) throw new Error(`rule ${name} missing`);
  return found;
}

describe("hard filters — initial profile", () => {
  it("passes a fixed-price $800 job with verified payment", () => {
    const summary = evaluateHardChecks(makeJob(), config(), context);
    expect(summary.status).toBe("PENDING_AI");
    expect(summary.rejectionReasons).toEqual([]);
  });

  it("rejects a $499 budget and accepts exactly $500", () => {
    const low = evaluateHardChecks(makeJob({ budgetAmount: "499.00" }), config(), context);
    expect(low.status).toBe("FILTERED_OUT");
    expect(rule(low, "BUDGET").reasonCode).toBe("BUDGET_BELOW_MINIMUM");

    const edge = evaluateHardChecks(makeJob({ budgetAmount: "500.00" }), config(), context);
    expect(rule(edge, "BUDGET").outcome).toBe("PASS");
    expect(edge.status).toBe("PENDING_AI");
  });

  it("rejects $499.99 (no float rounding up to 500)", () => {
    const summary = evaluateHardChecks(makeJob({ budgetAmount: "499.99" }), config(), context);
    expect(rule(summary, "BUDGET").outcome).toBe("FAIL");
  });

  it("rejects a $400 job regardless of anything else", () => {
    const summary = evaluateHardChecks(makeJob({ budgetAmount: "400" }), config(), context);
    expect(summary.status).toBe("FILTERED_OUT");
  });

  it("judges a range by its lower bound", () => {
    const summary = evaluateHardChecks(makeJob({ budgetAmount: "300.00", budgetMax: "900.00" }), config(), context);
    expect(rule(summary, "BUDGET").outcome).toBe("FAIL");
  });

  it("rejects hourly jobs under the fixed-price-only rule", () => {
    const summary = evaluateHardChecks(
      makeJob({ budgetType: "HOURLY", budgetAmount: null, hourlyMin: "50.00", hourlyMax: "80.00" }),
      config(),
      context,
    );
    expect(summary.status).toBe("FILTERED_OUT");
    expect(rule(summary, "JOB_TYPE").reasonCode).toBe("JOB_TYPE_MISMATCH");
  });

  it("treats unknown payment verification as not passing", () => {
    const summary = evaluateHardChecks(makeJob({ paymentVerified: null }), config(), context);
    expect(summary.status).toBe("FILTERED_OUT");
    expect(rule(summary, "PAYMENT_VERIFIED").outcome).toBe("UNKNOWN");
  });

  it("does not infer payment verification from strong client history", () => {
    const summary = evaluateHardChecks(
      makeJob({ paymentVerified: null, clientTotalSpent: "1000000.00", clientHires: 500, clientRating: "5.00" }),
      config(),
      context,
    );
    expect(rule(summary, "PAYMENT_VERIFIED").effect).toBe("REJECT");
  });

  it("marks a missing budget as UNKNOWN and rejects under the default policy", () => {
    const summary = evaluateHardChecks(makeJob({ budgetAmount: null }), config(), context);
    expect(rule(summary, "BUDGET").outcome).toBe("UNKNOWN");
    expect(summary.status).toBe("FILTERED_OUT");
  });

  it("sends a missing budget to review when the policy says so", () => {
    const summary = evaluateHardChecks(
      makeJob({ budgetAmount: null }),
      config((c) => (c.budget.missingBudgetPolicy = "NEEDS_REVIEW")),
      context,
    );
    expect(summary.status).toBe("NEEDS_REVIEW");
  });

  it("rejects an unauthorized source and invalid or fabricated URLs", () => {
    expect(evaluateHardChecks(makeJob(), config(), { ...context, sourceAuthorized: false }).status).toBe(
      "FILTERED_OUT",
    );
    for (const jobUrl of [null, "http://example.com/x", "https://evil.test/jobs/1", "javascript:alert(1)"]) {
      const summary = evaluateHardChecks(makeJob({ jobUrl }), config(), context);
      expect(rule(summary, "VALID_URL").outcome).toBe("FAIL");
    }
  });

  it("rejects jobs already notified to the same recipient", () => {
    const summary = evaluateHardChecks(makeJob(), config(), { ...context, alreadyNotified: true });
    expect(rule(summary, "NOT_PREVIOUSLY_NOTIFIED").reasonCode).toBe("ALREADY_NOTIFIED");
  });
});

describe("hard filters — currency policy", () => {
  it("treats a foreign currency as UNKNOWN without a configured rate", () => {
    const summary = evaluateHardChecks(makeJob({ currency: "EUR" }), config(), context);
    expect(rule(summary, "CURRENCY").reasonCode).toBe("CURRENCY_NOT_CONVERTIBLE");
    expect(summary.status).toBe("FILTERED_OUT");
  });

  it("converts with a configured fixed rate, rounding down", () => {
    const withRate = config((c) => (c.budget.currencyPolicy = { mode: "FIXED_RATES", rates: { EUR: "1.08" } }));
    // 463.00 EUR * 1.08 = 500.04 USD -> passes
    expect(evaluateHardChecks(makeJob({ currency: "EUR", budgetAmount: "463.00" }), withRate, context).status).toBe(
      "PENDING_AI",
    );
    // 462.96 EUR * 1.08 = 499.9968 -> 499.99 USD -> fails
    const fail = evaluateHardChecks(makeJob({ currency: "EUR", budgetAmount: "462.96" }), withRate, context);
    expect(rule(fail, "BUDGET").outcome).toBe("FAIL");
  });
});

describe("hard filters — skills and keywords", () => {
  it("does not accept a single incidental description mention as a required-skill match", () => {
    const job = makeJob({
      title: "Logo design for bakery",
      description:
        "We need a modern logo for our bakery brand. Our old website was built in React years ago but this job is only about branding and print assets.",
      skills: ["Graphic Design"],
    });
    const summary = evaluateHardChecks(job, config(), context);
    expect(rule(summary, "REQUIRED_SKILLS").reasonCode).toBe("SKILLS_ONLY_INCIDENTAL");
    expect(summary.status).toBe("FILTERED_OUT");
  });

  it("matches aliases and respects word boundaries", () => {
    const job = makeJob({ title: "Reactive programming tutor", skills: [], description: "x".repeat(60) });
    expect(rule(evaluateHardChecks(job, config(), context), "REQUIRED_SKILLS").outcome).toBe("FAIL");
    const alias = makeJob({ title: "ReactJS widget", skills: [] });
    expect(rule(evaluateHardChecks(alias, config(), context), "REQUIRED_SKILLS").outcome).toBe("PASS");
  });

  it("enforces exclude keywords and required combinations", () => {
    const excluded = evaluateHardChecks(
      makeJob({ description: makeJob().description + " WordPress theme tweaks." }),
      config((c) => (c.skills.excludeKeywords = ["WordPress"])),
      context,
    );
    expect(rule(excluded, "EXCLUDE_KEYWORDS").outcome).toBe("FAIL");

    const combo = config((c) => (c.skills.requiredCombinations = [["Zoho", "Deluge"]]));
    expect(rule(evaluateHardChecks(makeJob(), combo, context), "REQUIRED_COMBINATIONS").outcome).toBe("FAIL");
  });

  it("requires every required skill in ALL mode", () => {
    const all = config((c) => (c.skills.requiredMatchMode = "ALL"));
    expect(evaluateHardChecks(makeJob(), all, context).status).toBe("FILTERED_OUT");
  });
});

describe("hard filters — optional client conditions", () => {
  it("is NOT_APPLICABLE when not configured and UNKNOWN when data is missing", () => {
    expect(rule(evaluateHardChecks(makeJob(), config(), context), "CLIENT_RATING").outcome).toBe("NOT_APPLICABLE");
    const withMin = config((c) => (c.client.minRating = 4.5));
    const summary = evaluateHardChecks(makeJob({ clientRating: null }), withMin, context);
    expect(rule(summary, "CLIENT_RATING").outcome).toBe("UNKNOWN");
    expect(summary.status).toBe("FILTERED_OUT");
  });

  it("honours the IGNORE policy for unavailable client data", () => {
    const lenient = config((c) => {
      c.client.minHires = 5;
      c.client.unknownClientDataPolicy = "IGNORE";
    });
    expect(evaluateHardChecks(makeJob({ clientHires: null }), lenient, context).status).toBe("PENDING_AI");
  });

  it("applies location allow and block lists", () => {
    const blocked = config((c) => (c.client.blockedCountries = ["United States"]));
    expect(rule(evaluateHardChecks(makeJob(), blocked, context), "CLIENT_LOCATION").outcome).toBe("FAIL");
  });
});
