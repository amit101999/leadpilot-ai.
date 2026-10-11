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
  sourceMetadata: Record<string, unknown>;
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

export class SourceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceUnavailableError";
  }
}
