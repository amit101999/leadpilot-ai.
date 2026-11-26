import { describe, expect, it } from "vitest";
import { EMPTY_POSTING } from "@/modules/job-sources/types";
import { defaultProfileConfig, type ProfileConfig } from "@/modules/profiles/config-schema";
import { parseStoredConfig } from "@/modules/profiles/service";
import { decideEligibility, warmThreshold } from "@/modules/qualification/eligibility";
import { evaluateHardChecks, type HardRule } from "@/modules/qualification/hard-filters";
import { computePotential } from "@/modules/qualification/potential";
import { blendLeadScore } from "@/modules/qualification/scoring";
import { makeAiOutput, makeClient, makeJob } from "../fixtures/jobs";

const context = { sourceAuthorized: true, alreadyNotified: false };
const config = (mutate?: (c: ProfileConfig) => void) => {
  const c = defaultProfileConfig(null);
  mutate?.(c);
  return c;
};
const posting = (p: Partial<typeof EMPTY_POSTING>) => ({ ...EMPTY_POSTING, ...p });
const rule = (summary: ReturnType<typeof evaluateHardChecks>, name: HardRule) =>
  summary.results.find((r) => r.rule === name)!;

describe("soft rules (default)", () => {
  it("keeps a crowded, low-budget job with a weak client in the race instead of rejecting it", () => {
    const job = makeJob({
      budgetAmount: "100.00",
      paymentVerified: false,
      posting: posting({ proposalsTier: "50+", interviewing: 12, invitesSent: 30 }),
      client: makeClient({ hireRatePercent: 10, paymentVerified: false }),
    });
    const summary = evaluateHardChecks(job, config(), context);
    expect(summary.status).toBe("PENDING_AI");
    for (const name of [
      "BUDGET",
      "PAYMENT_VERIFIED",
      "PROPOSALS",
      "INTERVIEWING",
      "INVITES",
      "CLIENT_HIRE_RATE",
    ] as const) {
      expect(rule(summary, name)).toMatchObject({ outcome: "FAIL", effect: "CONTINUE", soft: true });
    }
  });

  it("still rejects the wrong kind of work and filled postings", () => {
    const hired = evaluateHardChecks(makeJob({ posting: posting({ hiresMade: 1 }) }), config(), context);
    expect(hired.status).toBe("FILTERED_OUT");
    const hourly = evaluateHardChecks(
      makeJob({ budgetType: "HOURLY", budgetAmount: null, hourlyMin: "40.00", hourlyMax: "60.00" }),
      config(),
      context,
    );
    expect(rule(hourly, "JOB_TYPE").effect).toBe("REJECT");
  });

  it("rejects like before when soft rules are switched off", () => {
    const job = makeJob({ posting: posting({ proposalsTier: "50+" }) });
    const strict = evaluateHardChecks(
      job,
      config((c) => (c.leads.softRules = false)),
      context,
    );
    expect(strict.status).toBe("FILTERED_OUT");
  });
});

describe("Potential score", () => {
  const now = new Date("2026-11-26T12:00:00Z");

  it("rewards low competition, a strong client, a fitting budget and long-term work", () => {
    const job = makeJob({
      postedAt: new Date("2026-11-26T10:00:00Z"),
      posting: posting({
        proposalsTier: "Less than 5",
        duration: "More than 6 months",
        workload: "Full-time",
      }),
    });
    const p = computePotential(job, job.client, config(), now);
    expect(p.signals).toEqual({ competition: 25, client: 25, budget: 25, longTerm: 25 });
    expect(p.score).toBe(100);
    expect(p.reasons).toEqual(
      expect.arrayContaining(["Few proposals (Less than 5)", "Posted in the last 6 hours"]),
    );
  });

  it("scores a crowded, short, under-budget job from a weak client low", () => {
    const job = makeJob({
      budgetAmount: "100.00",
      posting: posting({
        proposalsTier: "50+",
        interviewing: 9,
        invitesSent: 20,
        duration: "Less than 1 month",
      }),
    });
    const client = makeClient({
      paymentVerified: false,
      hireRatePercent: 5,
      totalSpent: "0",
      rating: "3.10",
    });
    const p = computePotential(job, client, config(), now);
    expect(p.signals.competition).toBe(0);
    expect(p.signals.budget).toBe(0);
    expect(p.signals.longTerm).toBe(5);
    expect(p.score).toBeLessThan(15);
    expect(p.reasons).toEqual(expect.arrayContaining(["Payment not verified"]));
  });

  it("scores missing data in the middle, so unknowns do not sink a job", () => {
    const job = makeJob({
      budgetAmount: null,
      paymentVerified: null,
      clientRating: null,
      clientTotalSpent: null,
      postedAt: null,
      client: null,
    });
    const p = computePotential(job, null, config(), now);
    expect(p.score).toBeGreaterThanOrEqual(30);
    expect(p.score).toBeLessThanOrEqual(45);
  });
});

describe("lead score and tiers", () => {
  it("blends the AI fit score with Potential by the profile's fit weight", () => {
    expect(blendLeadScore(80, 40, config())).toBe(64); // 60% of 80 + 40% of 40
    expect(
      blendLeadScore(
        80,
        40,
        config((c) => (c.leads.fitWeight = 100)),
      ),
    ).toBe(80);
    expect(blendLeadScore(81, 40, config())).toBe(65); // 64.6 rounds up
  });

  it("grades Hot at the minimum score, Warm up to 20 points below, Cold below that", () => {
    const c = config(); // minScore 75, warm from 55
    expect(warmThreshold(c)).toBe(55);
    const decide = (score: number) =>
      decideEligibility(
        {
          hardChecks: { status: "PENDING_AI", results: [], rejectionReasons: [], skillMatches: [] },
          ai: makeAiOutput(score),
          authoritativeScore: score,
          alreadyNotified: false,
        },
        c,
      );
    expect(decide(75)).toMatchObject({ decision: "QUALIFIED", tier: "HOT" });
    expect(decide(74)).toMatchObject({ decision: "QUALIFIED", tier: "WARM" });
    expect(decide(55)).toMatchObject({ decision: "QUALIFIED", tier: "WARM" });
    expect(decide(54)).toMatchObject({ decision: "REJECTED", tier: "COLD" });
  });

  it("gives profiles saved before lead grading the defaults (soft rules on)", () => {
    const { leads: _l, ...old } = defaultProfileConfig(null);
    const parsed = parseStoredConfig(JSON.parse(JSON.stringify(old)));
    expect(parsed.leads).toEqual({ softRules: true, fitWeight: 60, warmBelowHot: 20 });
  });
});
