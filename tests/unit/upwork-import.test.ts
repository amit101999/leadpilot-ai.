import { describe, expect, it } from "vitest";
import {
  canonicalUpworkUrl,
  cleanText,
  normalizeUpworkMcpJob,
  parseStagedJob,
  toDecimal,
  upworkMcpJobSchema,
} from "@/modules/job-sources/upwork-import/normalize";
import {
  localClock,
  nextSyncAt,
  scanWindow,
  syncDue,
  syncIsStale,
  type SyncTarget,
  withinActiveHours,
} from "@/modules/imports/schedule";
import detailsFixed from "../fixtures/upwork/details-fixed.json";
import detailsHourly from "../fixtures/upwork/details-hourly.json";
import searchHourly from "../fixtures/upwork/search-hourly.json";
import { DEFAULT_SCHEDULE, type Schedule } from "@/modules/scheduler/schema";

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
    expect(job.sourceMetadata).toEqual({ origin: "upwork-mcp", detailsFetched: false });
    expect(job.posting).toMatchObject({
      experienceLevel: "Intermediate",
      proposalsTier: "5 to 10",
      detailsFetchedAt: null,
      connectsCost: null,
    });
    // Search data alone never identifies the client.
    expect(job.client).toBeNull();
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
        attachments: [{ link: "https://bucket.s3.amazonaws.com/x?X-Amz-Security-Token=must-be-dropped" }],
      },
    });
    expect(job).toMatchObject({
      clientHires: 151,
      category: "Web, Mobile & Software Dev",
      currency: "USD",
      description: "Full description from details.",
    });
    expect(job.sourceMetadata).toEqual({ origin: "upwork-mcp", detailsFetched: true });
    expect(job.posting).toMatchObject({ hiresMade: 1, invitesSent: 0 });
    expect(job.posting.detailsFetchedAt).toBeInstanceOf(Date);
    // Details without a client company id cannot be linked to a client.
    expect(job.client).toBeNull();
    expect(JSON.stringify(job)).not.toContain("must-be-dropped");
  });

  it("maps a recorded hourly job with its full client record", () => {
    const now = new Date("2026-11-17T16:00:00Z");
    const job = normalizeUpworkMcpJob(
      upworkMcpJobSchema.parse({ ...searchHourly, details: detailsHourly }),
      now,
    );
    expect(job).toMatchObject({
      budgetType: "HOURLY",
      hourlyMin: "10.00",
      hourlyMax: "20.00",
      clientRating: "4.99",
      clientHires: 33,
      clientTotalSpent: "34285.90",
      clientCountry: "United States",
      jobUrl: "https://www.upwork.com/jobs/~022122661073608733679",
    });
    expect(job.posting).toEqual({
      subcategory: "Scripts & Utilities",
      experienceLevel: "Expert",
      duration: "1 to 3 months",
      workload: "Part time",
      personsToHire: 1,
      proposalsTier: "50+",
      connectsCost: 26,
      featured: true,
      invitesSent: 39,
      interviewing: 25,
      offersMade: 0,
      hiresMade: 0,
      workflowStatus: "ACTIVE",
      preferredQualifications: detailsHourly.preferred_qualifications,
      detailsFetchedAt: now,
    });
    expect(job.client).toMatchObject({
      sourceClientId: "1001859645",
      country: "United States",
      state: "PA",
      timezone: "America/New_York",
      paymentVerified: true,
      rating: "4.99",
      reviewsCount: 16,
      totalSpent: "34285.90",
      totalHires: 33,
      jobsWithHires: 27,
      activeContracts: 7,
      hoursTotal: "3606.17",
      jobsPosted: 35,
      openJobs: 1,
      hireRatePercent: 77,
    });
    const client = job.client!;
    expect(client.recentReviews).toHaveLength(2);
    expect(client.recentReviews[0]).toMatchObject({ score: 5, endedAt: "2026-08-15T18:51:58.759Z" });
    expect(client.recentReviews[0]!.comment).not.toContain("untrusted_participant_content");
    expect(client.workHistory.open).toHaveLength(2);
    expect(client.workHistory.closed[0]).toMatchObject({
      type: "FIXED",
      status: "CLOSED",
      feedbackToClient: 5,
    });
    // Signed attachment links (temporary S3 credentials) never reach the stored record.
    expect(JSON.stringify(job)).not.toContain("X-Amz");
  });

  it("maps a recorded fixed-price job with details but no search client block", () => {
    const job = normalize({
      id: "2121777721694126333",
      title: "SuiteDash",
      job_type: "fixed",
      details: detailsFixed,
    });
    expect(job).toMatchObject({
      budgetType: "FIXED",
      budgetAmount: "250.00",
      currency: "USD",
      clientRating: "4.59",
    });
    expect(job.posting).toMatchObject({ subcategory: "Web Development", experienceLevel: "Intermediate" });
    expect(job.client).toMatchObject({ sourceClientId: "4793565", state: "FL", hireRatePercent: 33 });
    // Payment verification comes only from the search row: unknown here, never assumed.
    expect(job.client!.paymentVerified).toBeNull();
  });

  it("clips third-party text and caps lists instead of rejecting the job", () => {
    const review = { title: "t", comment: "c".repeat(5_000), score: 5 };
    const job = normalize({
      ...searchItem,
      details: {
        data: { marketplaceJobPosting: { clientCompanyPublic: { id: "77" } } },
        client_feedback: { reviews: Array(9).fill(review) },
        client_work_history: { closed: Array(9).fill({ title: "x".repeat(900) }) },
      },
    });
    const client = job.client!;
    expect(client.recentReviews).toHaveLength(5);
    expect(client.recentReviews[0]!.comment).toHaveLength(2_000);
    expect(client.workHistory.closed).toHaveLength(5);
    expect(client.workHistory.closed[0]!.title).toHaveLength(300);
  });

  it("never assumes payment verification or a rating that is not there", () => {
    expect(normalize({ ...searchItem, client: { verification_status: "UNVERIFIED" } }).paymentVerified).toBe(
      false,
    );
    expect(normalize({ ...searchItem, client: {} }).paymentVerified).toBeNull();
    expect(normalize({ ...searchItem, client: { rating: 0, total_reviews: 0 } }).clientRating).toBeNull();
  });

  it("recognises other spellings of the job type", () => {
    expect(normalize({ ...searchItem, job_type: "Fixed price" }).budgetType).toBe("FIXED");
    expect(normalize({ ...searchItem, job_type: "HOURLY_RATE", budget: "20" }).budgetType).toBe("HOURLY");
    const withDetails = normalize({
      ...searchItem,
      details: { data: { marketplaceJobPosting: { contractTerms: { contractType: "FIXED_PRICE" } } } },
    });
    expect(withDetails.budgetType).toBe("FIXED");
    expect(normalize({ ...searchItem, job_type: "contract" }).budgetType).toBe("UNKNOWN");
  });

  it("reads hourly ranges and leaves fixed fields empty", () => {
    const job = normalize({ ...searchItem, job_type: "hourly", budget: "$15.00 - $30.00/hr" });
    expect(job).toMatchObject({
      budgetType: "HOURLY",
      budgetAmount: null,
      hourlyMin: "15.00",
      hourlyMax: "30.00",
    });
    // Upwork's search results separate the range with an en dash.
    expect(normalize({ ...searchItem, job_type: "hourly", budget: "7.00–27.00/hr" })).toMatchObject({
      hourlyMin: "7.00",
      hourlyMax: "27.00",
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
    const rich = normalize({ ...searchHourly, details: detailsHourly });
    expect(parseStagedJob(JSON.parse(JSON.stringify(rich)))).toEqual(rich);
    expect(parseStagedJob({ title: "broken" })).toBeNull();
  });

  it("still loads payloads queued before posting and client data existed", () => {
    const {
      posting: _posting,
      client: _client,
      ...older
    } = JSON.parse(JSON.stringify(normalize(searchItem)));
    const revived = parseStagedJob(older);
    expect(revived?.posting.detailsFetchedAt).toBeNull();
    expect(revived?.client).toBeNull();
  });
});

describe("sync schedule", () => {
  /** The active profile with the given scheduler settings. */
  const search = (sync: Partial<Schedule> = {}): SyncTarget => ({
    schedule: { ...DEFAULT_SCHEDULE, ...sync },
    active: true,
    keywords: ["Zoho"],
  });
  const at = (iso: string) => new Date(iso);

  it("never syncs an inactive profile", () => {
    const now = at("2026-11-18T12:00:00Z");
    const inactive = { ...search(), active: false };
    expect(syncDue(inactive, null, now)).toEqual({ due: false, reason: "Not the active profile" });
    expect(nextSyncAt(inactive, null, now)).toBeNull();
    expect(syncIsStale(inactive, at("2026-11-17T00:00:00Z"), now)).toBe(false);
  });

  it("is never due while the scheduler is off", () => {
    expect(syncDue(search({ enabled: false }), null, at("2026-11-18T12:00:00Z"))).toEqual({
      due: false,
      reason: "The sync scheduler is off",
    });
  });

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
    const daytime = search({ activeFrom: "08:00", activeTo: "22:00" });
    expect(syncDue(daytime, null, now)).toMatchObject({
      due: false,
      reason: expect.stringContaining("active hours"),
    });
    // The default now syncs around the clock.
    expect(syncDue(search(), null, now)).toEqual({ due: true });
  });

  it("scans from the last successful window end minus the overlap, at most 24 h back", () => {
    const now = at("2026-11-18T12:00:00Z");
    expect(scanWindow(null, 4, now)).toEqual({ from: at("2026-11-18T08:00:00Z"), to: now });
    expect(scanWindow(at("2026-11-18T08:18:00Z"), 4, now).from).toEqual(at("2026-11-18T07:48:00Z"));
    expect(scanWindow(at("2026-11-10T00:00:00Z"), 4, now).from).toEqual(at("2026-11-17T12:00:00Z"));
    // A window end later than now (clock skew) never yields a window starting in the future.
    expect(scanWindow(at("2026-11-18T12:40:00Z"), 4, now).from).toEqual(now);
  });

  it("tells when the profile is next due", () => {
    const now = at("2026-11-18T12:00:00Z");
    expect(nextSyncAt(search({ everyHours: 4 }), null, now)).toEqual(now);
    expect(nextSyncAt(search({ everyHours: 4 }), at("2026-11-18T10:18:00Z"), now)).toEqual(
      at("2026-11-18T14:13:00Z"),
    );
    expect(nextSyncAt(search({ everyHours: 1 }), at("2026-11-18T10:18:00Z"), now)).toEqual(now);
    // Outside active hours it moves to the next window start.
    const daytime = search({ everyHours: 2, activeFrom: "08:00", activeTo: "22:00" });
    // Synced at 21:30, due again at 23:25 = after 22:00, so next morning at 08:00.
    expect(nextSyncAt(daytime, at("2026-11-18T21:30:00Z"), at("2026-11-18T22:00:00Z"))).toEqual(
      at("2026-11-19T08:00:00Z"),
    );
    expect(nextSyncAt(search({ enabled: false }), null, now)).toBeNull();
    expect(nextSyncAt({ ...search(), keywords: [] }, null, now)).toBeNull();
  });

  it("flags a profile the sync agent has stopped checking in for", () => {
    const last = at("2026-11-18T08:18:00Z");
    // Due at 12:13; the hourly routine should have come by 13:28.
    expect(syncIsStale(search({ everyHours: 4 }), last, at("2026-11-18T13:20:00Z"))).toBe(false);
    expect(syncIsStale(search({ everyHours: 4 }), last, at("2026-11-18T13:30:00Z"))).toBe(true);
    // Overnight inactivity is not the agent's fault: due again at 08:00, stale only after 09:15.
    const daytime = search({ everyHours: 2, activeFrom: "08:00", activeTo: "22:00" });
    expect(syncIsStale(daytime, at("2026-11-18T21:30:00Z"), at("2026-11-19T08:30:00Z"))).toBe(false);
    expect(syncIsStale(daytime, at("2026-11-18T21:30:00Z"), at("2026-11-19T09:20:00Z"))).toBe(true);
    expect(syncIsStale(search(), null, at("2026-11-19T09:20:00Z"))).toBe(false);
  });
});
