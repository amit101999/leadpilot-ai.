import { describe, expect, it } from "vitest";
import { EMPTY_POSTING } from "@/modules/job-sources/types";
import { normalizeUpworkMcpJob, upworkMcpJobSchema } from "@/modules/job-sources/upwork-import/normalize";
import { buildLeadEmail, type LeadMessageInput } from "@/modules/notifications/message";
import {
  defaultProfileConfig,
  DEFAULT_PREFERRED_COUNTRIES,
  type ProfileConfig,
} from "@/modules/profiles/config-schema";
import { parseStoredConfig } from "@/modules/profiles/service";
import { evaluateHardChecks, type HardRule } from "@/modules/qualification/hard-filters";
import { priorityCountryBonus, withBonus } from "@/modules/qualification/scoring";
import { makeClient, makeJob } from "../fixtures/jobs";
import detailsHourly from "../fixtures/upwork/details-hourly.json";
import searchHourly from "../fixtures/upwork/search-hourly.json";

const context = { sourceAuthorized: true, alreadyNotified: false };
const config = (mutate?: (c: ProfileConfig) => void) => {
  const c = defaultProfileConfig(null);
  mutate?.(c);
  return c;
};
const posting = (p: Partial<typeof EMPTY_POSTING>) => ({ ...EMPTY_POSTING, ...p });
const check = (job: ReturnType<typeof makeJob>, c: ProfileConfig, rule: HardRule) => {
  const summary = evaluateHardChecks(job, c, context);
  return { summary, result: summary.results.find((r) => r.rule === rule)! };
};

describe("competition rules (the team's hunting checklist)", () => {
  it("rejects a posting where the client already hired, unless turned off", () => {
    const job = makeJob({ posting: posting({ hiresMade: 1 }) });
    const { summary, result } = check(job, config(), "ALREADY_HIRED");
    expect(summary.status).toBe("FILTERED_OUT");
    expect(result).toMatchObject({ outcome: "FAIL", reasonCode: "ALREADY_HIRED" });
    expect(
      check(
        job,
        config((c) => (c.competition.rejectIfHired = false)),
        "ALREADY_HIRED",
      ).result.outcome,
    ).toBe("NOT_APPLICABLE");
    expect(
      check(makeJob({ posting: posting({ hiresMade: 0 }) }), config(), "ALREADY_HIRED").result.outcome,
    ).toBe("PASS");
  });

  it("compares proposal bands in Upwork's order and allows up to the profile's band", () => {
    const tier = (proposalsTier: string | null) =>
      check(makeJob({ posting: posting({ proposalsTier }) }), config(), "PROPOSALS").result;
    expect(tier("Less than 5").outcome).toBe("PASS");
    expect(tier("10 to 15").outcome).toBe("PASS");
    expect(tier("15 to 20")).toMatchObject({ outcome: "FAIL", reasonCode: "TOO_MANY_PROPOSALS" });
    expect(tier("50+").outcome).toBe("FAIL");
    // Unknown or unrecognised bands never reject.
    expect(tier(null).outcome).toBe("PASS");
    expect(tier("about thirty").outcome).toBe("PASS");
    const off = config((c) => (c.competition.maxProposalsTier = null));
    expect(
      check(makeJob({ posting: posting({ proposalsTier: "50+" }) }), off, "PROPOSALS").result.outcome,
    ).toBe("NOT_APPLICABLE");
  });

  it("rejects more than 3 interviewing or more than 10 invites; unknown counts pass", () => {
    const job = (p: Partial<typeof EMPTY_POSTING>) => makeJob({ posting: posting(p) });
    expect(check(job({ interviewing: 3 }), config(), "INTERVIEWING").result.outcome).toBe("PASS");
    expect(check(job({ interviewing: 4 }), config(), "INTERVIEWING").result.reasonCode).toBe(
      "TOO_MANY_INTERVIEWING",
    );
    expect(check(job({ invitesSent: 10 }), config(), "INVITES").result.outcome).toBe("PASS");
    expect(check(job({ invitesSent: 11 }), config(), "INVITES").result.reasonCode).toBe("TOO_MANY_INVITES");
    expect(check(job({}), config(), "INTERVIEWING").result.outcome).toBe("PASS");
    expect(check(job({}), config(), "INVITES").result.outcome).toBe("PASS");
  });
});

describe("a real recorded Upwork posting", () => {
  it("is rejected for its crowd: 25 interviewing, 39 invites, 50+ proposals", () => {
    const job = normalizeUpworkMcpJob(upworkMcpJobSchema.parse({ ...searchHourly, details: detailsHourly }));
    const summary = evaluateHardChecks(job, config(), context);
    expect(summary.status).toBe("FILTERED_OUT");
    const failed = summary.results.filter((r) => r.outcome === "FAIL").map((r) => r.rule);
    expect(failed).toEqual(expect.arrayContaining(["PROPOSALS", "INTERVIEWING", "INVITES"]));
    // Its client is good: hire rate 77%, so that rule passes.
    expect(summary.results.find((r) => r.rule === "CLIENT_HIRE_RATE")?.outcome).toBe("PASS");
  });
});

describe("client hire rate rule", () => {
  it("rejects a hire rate below 50% and accepts 50% or more", () => {
    const rate = (hireRatePercent: number) =>
      check(makeJob({ client: makeClient({ hireRatePercent }) }), config(), "CLIENT_HIRE_RATE");
    expect(rate(49).summary.status).toBe("FILTERED_OUT");
    expect(rate(49).result).toMatchObject({ reasonCode: "HIRE_RATE_BELOW_MINIMUM", observed: "49%" });
    expect(rate(50).result.outcome).toBe("PASS");
    expect(rate(80).result.outcome).toBe("PASS");
  });

  it("follows the unknown-client-data policy when the hire rate is unknown", () => {
    const job = makeJob({ client: null });
    expect(check(job, config(), "CLIENT_HIRE_RATE").summary.status).toBe("NEEDS_REVIEW");
    const ignore = config((c) => (c.client.unknownClientDataPolicy = "IGNORE"));
    expect(check(job, ignore, "CLIENT_HIRE_RATE").summary.status).toBe("PENDING_AI");
    const off = config((c) => (c.client.minHireRatePercent = null));
    expect(check(job, off, "CLIENT_HIRE_RATE").result.outcome).toBe("NOT_APPLICABLE");
  });
});

describe("priority-country bonus", () => {
  it("adds the bonus for a preferred country (any case) and nothing for others", () => {
    const c = config();
    expect(priorityCountryBonus("United States", c)).toEqual({ country: "United States", points: 5 });
    expect(priorityCountryBonus("germany", c)?.points).toBe(5);
    expect(priorityCountryBonus("India", c)).toBeNull();
    expect(priorityCountryBonus(null, c)).toBeNull();
    expect(
      priorityCountryBonus(
        "Canada",
        config((x) => (x.ai.preferredCountryBonus = 0)),
      ),
    ).toBeNull();
  });

  it("never lifts the score above 100", () => {
    expect(withBonus(72, { country: "Canada", points: 5 })).toBe(77);
    expect(withBonus(98, { country: "Canada", points: 5 })).toBe(100);
    expect(withBonus(72, null)).toBe(72);
  });
});

describe("profiles saved before the checklist rules", () => {
  it("load with the checklist defaults switched on", () => {
    const old = defaultProfileConfig(null) as Record<string, unknown> & ProfileConfig;
    const { competition: _c, ...rest } = old;
    const stored = {
      ...rest,
      client: { ...old.client, minHireRatePercent: undefined, preferredCountries: undefined },
      ai: { ...old.ai, preferredCountryBonus: undefined },
    };
    const parsed = parseStoredConfig(JSON.parse(JSON.stringify(stored)));
    expect(parsed.competition).toEqual({
      maxProposalsTier: "10 to 15",
      maxInterviewing: 3,
      maxInvitesSent: 10,
      rejectIfHired: true,
    });
    expect(parsed.client.minHireRatePercent).toBe(50);
    expect(parsed.client.preferredCountries).toEqual(DEFAULT_PREFERRED_COUNTRIES);
    expect(parsed.ai.preferredCountryBonus).toBe(5);
  });

  it("give every profile its own copy of the defaults", () => {
    const a = defaultProfileConfig(null);
    a.competition.maxInterviewing = 0;
    a.client.preferredCountries.push("India");
    const b = defaultProfileConfig(null);
    expect(b.competition.maxInterviewing).toBe(3);
    expect(b.client.preferredCountries).not.toContain("India");
  });
});

describe("lead e-mail checklist facts", () => {
  const lead = (overrides: Partial<LeadMessageInput> = {}): LeadMessageInput => ({
    title: "Zoho CRM build",
    budgetAmount: "800.00",
    budgetMax: null,
    currency: "USD",
    budgetType: "FIXED",
    paymentVerified: true,
    skills: ["Zoho CRM"],
    score: 88,
    reason: "Good fit",
    riskFlags: [],
    jobUrl: "https://www.upwork.com/jobs/~01",
    dashboardUrl: null,
    ...overrides,
  });

  it("shows the client and the competition, marking a priority country", () => {
    const { text } = buildLeadEmail(
      lead({
        client: {
          country: "United States",
          priorityCountry: true,
          hireRatePercent: 77,
          totalSpent: "34285.90",
        },
        competition: { proposalsTier: "10 to 15", interviewing: 2, invitesSent: null },
      }),
      "STANDARD",
    );
    expect(text).toContain("Client: United States (priority country) · hires on 77% · spent USD 34,285.90");
    expect(text).toContain("Competition: Proposals 10 to 15 · interviewing 2 · invites unknown");
  });

  it("escapes client text in the HTML body", () => {
    const { html } = buildLeadEmail(
      lead({
        client: { country: "<b>X</b>", priorityCountry: false, hireRatePercent: null, totalSpent: null },
      }),
      "STANDARD",
    );
    expect(html).not.toContain("<b>X</b>");
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
  });
});
