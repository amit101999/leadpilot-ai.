import { describe, expect, it } from "vitest";
import {
  canonicalUpworkUrl,
  cleanText,
  normalizeUpworkMcpJob,
  parseStagedJob,
  toDecimal,
  upworkMcpJobSchema,
} from "@/modules/job-sources/upwork-import/normalize";
import { localClock, syncDue, withinActiveHours } from "@/modules/imports/schedule";
import { DEFAULT_SEARCH_CONFIG, type SearchConfig } from "@/modules/profiles/config-schema";

/** Shape recorded from a real Upwork MCP `find_jobs` search result (2026-11-04). */
const searchItem = {
  id: "2117399309499514919",
  title: "ZOHO and ZOHO Forms Specialist Needed",
  description:
    "<untrusted_participant_content>\nWe need a ZOHO specialist.\n</untrusted_participant_content>",
  url: "https://www.upwork.com/jobs/~022117399309499514919?utm_campaign=LLM_claude_MCP_jobpost&utm_source=claude",
  job_type: "fixed",
  budget: "35.00",
  skills: ["Zoho CRM", "Zoho Creator"],
  experience_level: "intermediate",
  proposals_tier: "5 to 10",
  created_date: "2026-11-02T23:31:49.771Z",
  published_date: "2026-11-02T23:31:51.448Z",
  client: {
    country: "United States",
    rating: 4.81,
    total_posted_jobs: 197,
    total_reviews: 88,
    total_spent: "$23,575.22",
    verification_status: "VERIFIED",
  },
};

const normalize = (item: unknown) => normalizeUpworkMcpJob(upworkMcpJobSchema.parse(item));

describe("Upwork MCP job mapping", () => {
  it("maps a search result to the provider-neutral job", () => {
    const job = normalize(searchItem);
    expect(job).toMatchObject({
      source: "upwork",
      sourceJobId: "2117399309499514919",
      description: "We need a ZOHO specialist.",
      jobUrl: "https://www.upwork.com/jobs/~022117399309499514919",
      budgetType: "FIXED",
      budgetAmount: "35.00",
      currency: "USD",
      paymentVerified: true,
      clientRating: "4.81",
      clientHires: null,
      clientTotalSpent: "23575.22",
      clientCountry: "United States",
      category: null,
    });
    expect(job.postedAt?.toISOString()).toBe("2026-11-02T23:31:51.448Z");
    expect(job.sourceMetadata).toMatchObject({
      detailsFetched: false,
      proposalsTier: "5 to 10",
      client: { totalPostedJobs: 197, totalReviews: 88 },
    });
  });

  it("prefers job details for hires, category, currency and the client record", () => {
    const job = normalize({
      ...searchItem,
      details: {
        client_record: { contracts_total: 151, jobs_with_hires: 138, hire_rate_percent: 70, open_jobs: 5 },
        data: {
          marketplaceJobPosting: {
            content: {
              description:
                "<untrusted_participant_content>\nFull description from details.\n</untrusted_participant_content>",
            },
            classification: { category: { preferredLabel: "Web, Mobile & Software Dev" } },
            contractTerms: {
              contractType: "FIXED",
              fixedPriceContractTerms: { amount: { currency: "usd", rawValue: "35.0" } },
            },
            activityStat: { jobActivity: { totalHired: 1, invitesSent: 0 } },
          },
        },
        client_feedback: { reviews: [{ comment: "free text that must be dropped" }] },
      },
    });
    expect(job).toMatchObject({
      clientHires: 151,
      category: "Web, Mobile & Software Dev",
      currency: "USD",
      description: "Full description from details.",
    });
    expect(job.sourceMetadata).toMatchObject({
      detailsFetched: true,
      client: { hireRatePercent: 70, openJobs: 5 },
      job: { totalHired: 1 },
    });
    expect(JSON.stringify(job)).not.toContain("must be dropped");
  });

  it("never assumes payment verification or a rating that is not there", () => {
    expect(normalize({ ...searchItem, client: { verification_status: "UNVERIFIED" } }).paymentVerified).toBe(
      false,
    );
    expect(normalize({ ...searchItem, client: {} }).paymentVerified).toBeNull();
    expect(normalize({ ...searchItem, client: { rating: 0, total_reviews: 0 } }).clientRating).toBeNull();
  });

  it("reads hourly ranges and leaves fixed fields empty", () => {
    const job = normalize({ ...searchItem, job_type: "hourly", budget: "$15.00 - $30.00/hr" });
    expect(job).toMatchObject({
      budgetType: "HOURLY",
      budgetAmount: null,
      hourlyMin: "15.00",
      hourlyMax: "30.00",
    });
  });

  it("rejects unexpected ids and oversized fields instead of storing them", () => {
    expect(upworkMcpJobSchema.safeParse({ ...searchItem, id: "../etc/passwd" }).success).toBe(false);
    expect(upworkMcpJobSchema.safeParse({ ...searchItem, title: "" }).success).toBe(false);
    expect(upworkMcpJobSchema.safeParse({ ...searchItem, skills: Array(60).fill("x") }).success).toBe(false);
  });

  it("keeps only https Upwork links, without query strings", () => {
    expect(canonicalUpworkUrl("https://upwork.com/jobs/~01?x=1#y")).toBe("https://www.upwork.com/jobs/~01");
    expect(canonicalUpworkUrl("http://www.upwork.com/jobs/~01")).toBeNull();
    expect(canonicalUpworkUrl("https://upwork.com.evil.example/jobs/~01")).toBeNull();
    expect(canonicalUpworkUrl("not a url")).toBeNull();
  });

  it("parses money exactly and refuses anything else", () => {
    expect(toDecimal("$1,234.5")).toBe("1234.50");
    expect(toDecimal(35)).toBe("35.00");
    expect(toDecimal("about 500")).toBeNull();
    expect(toDecimal("-5")).toBeNull();
    expect(cleanText("<untrusted_participant_content>x</untrusted_participant_content>")).toBe("x");
  });

  it("round-trips through the staged payload", () => {
    const job = normalize(searchItem);
    const revived = parseStagedJob(JSON.parse(JSON.stringify(job)));
    expect(revived).toEqual(job);
    expect(parseStagedJob({ title: "broken" })).toBeNull();
  });
});

describe("sync schedule", () => {
  const search = (sync: Partial<SearchConfig["upworkSync"]> = {}): SearchConfig => ({
    ...DEFAULT_SEARCH_CONFIG,
    keywords: ["Zoho"],
    upworkSync: { ...DEFAULT_SEARCH_CONFIG.upworkSync, enabled: true, ...sync },
  });
  const at = (iso: string) => new Date(iso);

  it("reads the clock in the profile's time zone", () => {
    expect(localClock(at("2026-11-04T04:30:00Z"), "Asia/Kolkata")).toBe("10:00");
    expect(localClock(at("2026-11-04T04:30:00Z"), "UTC")).toBe("04:30");
  });

  it("supports windows that wrap past midnight", () => {
    expect(withinActiveHours("23:30", "22:00", "06:00")).toBe(true);
    expect(withinActiveHours("12:00", "22:00", "06:00")).toBe(false);
    expect(withinActiveHours("22:00", "08:00", "22:00")).toBe(true);
  });

  it("is due when never synced, and again after the interval minus a little slack", () => {
    const now = at("2026-11-04T10:00:00Z");
    expect(syncDue(search(), null, now)).toEqual({ due: true });
    expect(syncDue(search({ everyHours: 3 }), at("2026-11-04T07:04:00Z"), now)).toEqual({ due: true });
    expect(syncDue(search({ everyHours: 3 }), at("2026-11-04T07:30:00Z"), now).due).toBe(false);
  });

  it("is never due when off, without keywords, or outside active hours", () => {
    const now = at("2026-11-04T23:30:00Z");
    expect(syncDue(search({ enabled: false }), null, now).due).toBe(false);
    expect(syncDue({ ...search(), keywords: [] }, null, now).due).toBe(false);
    expect(syncDue(search(), null, now)).toMatchObject({
      due: false,
      reason: expect.stringContaining("active hours"),
    });
  });
});
