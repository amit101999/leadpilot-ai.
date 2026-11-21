import type { BudgetType } from "@/types/domain";
import type { ProfileConfig } from "@/modules/profiles/config-schema";

/**
 * Provider-neutral job record. The qualification engine depends only on this
 * shape, never on a specific platform's response format. `null` always means
 * "the source did not supply this value" (UNKNOWN), never "false"/"zero".
 */
export interface NormalizedJob {
  source: string;
  sourceJobId: string;
  title: string;
  description: string;
  jobUrl: string | null;
  budgetType: BudgetType;
  /** Fixed budget, or the lower bound of a fixed range. Decimal string. */
  budgetAmount: string | null;
  budgetMax: string | null;
  hourlyMin: string | null;
  hourlyMax: string | null;
  currency: string | null;
  paymentVerified: boolean | null;
  clientRating: string | null;
  clientHires: number | null;
  clientTotalSpent: string | null;
  clientCountry: string | null;
  skills: string[];
  category: string | null;
  postedAt: Date | null;
  /** Posting details beyond the qualification fields above (competition, hiring funnel, terms). */
  posting: JobPosting;
  /** The client's full record; null unless the source's job-detail call supplied a client identity. */
  client: NormalizedClient | null;
  sourceMetadata: Record<string, unknown>;
}

export type PreferredQualifications = Record<string, string | number | boolean | null>;

export interface JobPosting {
  subcategory: string | null;
  experienceLevel: string | null;
  duration: string | null;
  workload: string | null;
  personsToHire: number | null;
  proposalsTier: string | null;
  connectsCost: number | null;
  featured: boolean | null;
  /** This posting's hiring funnel (not the client's lifetime record). */
  invitesSent: number | null;
  interviewing: number | null;
  offersMade: number | null;
  hiresMade: number | null;
  workflowStatus: string | null;
  preferredQualifications: PreferredQualifications | null;
  /** When the full job details were fetched; null = search data only. */
  detailsFetchedAt: Date | null;
}

export const EMPTY_POSTING: JobPosting = {
  subcategory: null,
  experienceLevel: null,
  duration: null,
  workload: null,
  personsToHire: null,
  proposalsTier: null,
  connectsCost: null,
  featured: null,
  invitesSent: null,
  interviewing: null,
  offersMade: null,
  hiresMade: null,
  workflowStatus: null,
  preferredQualifications: null,
  detailsFetchedAt: null,
};

/**
 * Text in these lists is written by third parties. It is stored and shown in the UI as plain text,
 * and is never sent to the AI model.
 */
export interface ClientReview {
  title: string;
  comment: string;
  score: number | null;
  endedAt: string | null;
}

export interface ClientContract {
  title: string;
  type: string | null;
  status: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Score the freelancer gave the client for this contract. */
  feedbackToClient: number | null;
}

export interface ClientOpenJob {
  sourceJobId: string;
  title: string;
  jobType: string | null;
  url: string | null;
}

export interface NormalizedClient {
  /** The platform's stable client (company) id. */
  sourceClientId: string;
  country: string | null;
  state: string | null;
  timezone: string | null;
  paymentVerified: boolean | null;
  /** Average score freelancers gave this client, 0–5 as a decimal string. */
  rating: string | null;
  reviewsCount: number | null;
  totalSpent: string | null;
  totalHires: number | null;
  jobsWithHires: number | null;
  activeContracts: number | null;
  hoursTotal: string | null;
  jobsPosted: number | null;
  openJobs: number | null;
  hireRatePercent: number | null;
  recentReviews: ClientReview[];
  workHistory: { open: ClientContract[]; closed: ClientContract[] };
  otherOpenJobs: ClientOpenJob[];
}

export type SourceConnectionState =
  "CONNECTED" | "NOT_CONFIGURED" | "NOT_AUTHORIZED" | "UNAVAILABLE" | "MOCK";

export interface SourceConnectionResult {
  state: SourceConnectionState;
  /** Human-readable, non-sensitive explanation (shown in the UI). */
  message: string;
  missing?: string[];
}

export interface SourceCapabilities {
  /** Fields the provider can actually supply. Missing fields are evaluated as UNKNOWN. */
  fields: Array<keyof NormalizedJob>;
  supportsPagination: boolean;
  supportsJobDetails: boolean;
  isMock: boolean;
}

export interface DiscoverPage {
  records: unknown[];
  nextCursor: string | null;
}

export interface RateLimitState {
  remaining: number | null;
  resetAt: Date | null;
}

export interface JobSourceProvider {
  readonly id: string;
  checkConnection(): Promise<SourceConnectionResult>;
  getCapabilities(): SourceCapabilities;
  discoverJobs(profile: ProfileConfig, cursor: string | null): Promise<DiscoverPage>;
  /** Returns null when the record cannot be normalized (missing identity, malformed). */
  normalizeJob(sourceRecord: unknown): NormalizedJob | null;
  getJobDetails?(sourceJobId: string): Promise<unknown>;
  getRateLimitState?(): RateLimitState;
}

export class SourceNotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceNotAuthorizedError";
  }
}

/** The most jobs one run's discovery links (a safety limit; the import source claims no more than this). */
export const MAX_JOBS_PER_RUN = 500;
