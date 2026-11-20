import { EMPTY_POSTING, type NormalizedClient, type NormalizedJob } from "@/modules/job-sources/types";
import type { AiOutput } from "@/modules/ai/output-schema";

/** A client record as a job-detail call supplies it: a good client by the team's checklist. */
export function makeClient(overrides: Partial<NormalizedClient> = {}): NormalizedClient {
  return {
    sourceClientId: "client-1",
    country: "United States",
    state: "CA",
    timezone: "America/Los_Angeles",
    paymentVerified: true,
    rating: "4.90",
    reviewsCount: 10,
    totalSpent: "25000.00",
    totalHires: 12,
    jobsWithHires: 10,
    activeContracts: 2,
    hoursTotal: "500.00",
    jobsPosted: 14,
    openJobs: 1,
    hireRatePercent: 71,
    recentReviews: [],
    workHistory: { open: [], closed: [] },
    otherOpenJobs: [],
    ...overrides,
  };
}

/** A job (with its client's full record) that satisfies every hard filter of the default profile. */
export function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    source: "mock",
    sourceJobId: "job-1",
    title: "Build a React dashboard with Node.js API and Zoho CRM integration",
    description:
      "We need a React and Node.js developer to build a dashboard that syncs deals from Zoho CRM via API integrations. Clear milestones, existing designs provided.",
    jobUrl: "https://example.com/mock-jobs/job-1",
    budgetType: "FIXED",
    budgetAmount: "800.00",
    budgetMax: null,
    hourlyMin: null,
    hourlyMax: null,
    currency: "USD",
    paymentVerified: true,
    clientRating: "4.90",
    clientHires: 12,
    clientTotalSpent: "25000.00",
    clientCountry: "United States",
    skills: ["React", "Node.js", "Zoho CRM"],
    category: "Web Development",
    postedAt: new Date("2026-10-01T10:00:00Z"),
    posting: EMPTY_POSTING,
    client: makeClient(),
    sourceMetadata: {},
    ...overrides,
  };
}

/** Valid AI output whose weighted score (default weights) equals `target` when all dimensions are equal. */
export function makeAiOutput(target = 88, overrides: Partial<AiOutput> = {}): AiOutput {
  const detail = { evidence: ["Title mentions React"], explanation: "Fits", missing_information: [] };
  return {
    score: target,
    dimension_scores: {
      skill_alignment: target,
      scope_fit: target,
      description_clarity: target,
      client_credibility: target,
      overall_relevance: target,
    },
    dimension_details: {
      skill_alignment: detail,
      scope_fit: detail,
      description_clarity: detail,
      client_credibility: detail,
      overall_relevance: detail,
    },
    skill_matches: ["React", "Node.js"],
    scope_summary: "Dashboard with CRM sync",
    positive_signals: [],
    risk_flags: [],
    missing_information: [],
    reasoning_summary: "Strong technical fit",
    ...overrides,
  };
}
