import type { ProfileConfig } from "@/modules/profiles/config-schema";
import type {
  DiscoverPage,
  JobSourceProvider,
  NormalizedJob,
  SourceCapabilities,
  SourceConnectionResult,
} from "./types";
import { SourceNotAuthorizedError } from "./types";

/**
 * Upwork live job source — intentionally NOT implemented beyond configuration
 * checks. See docs/upwork-access.md.
 *
 * Live discovery requires an approved Upwork API key (OAuth 2.0) with the job
 * search scope granted, and confirmation that the approved access returns the
 * fields the qualification engine needs (budget, job type, client payment
 * verification, skills, description, canonical URL). Until that is confirmed
 * against Upwork's official documentation for the granted key, this provider
 * reports NOT_AUTHORIZED and refuses to discover jobs. It never scrapes pages,
 * reuses browser sessions or guesses endpoints.
 */
export class UpworkJobSourceProvider implements JobSourceProvider {
  readonly id = "upwork";

  constructor(
    private readonly credentials: { clientId?: string; clientSecret?: string },
    private readonly scopeConfirmed: boolean,
  ) {}

  async checkConnection(): Promise<SourceConnectionResult> {
    const missing = [
      !this.credentials.clientId && "UPWORK_CLIENT_ID",
      !this.credentials.clientSecret && "UPWORK_CLIENT_SECRET",
    ].filter((v): v is string => Boolean(v));
    if (missing.length > 0) {
      return {
        state: "NOT_CONFIGURED",
        message: "Upwork API credentials are not configured. Live discovery is blocked.",
        missing,
      };
    }
    if (!this.scopeConfirmed) {
      return {
        state: "NOT_AUTHORIZED",
        message:
          "Upwork job-search access has not been confirmed (UPWORK_JOB_SEARCH_SCOPE_CONFIRMED=false). Live discovery is blocked.",
        missing: ["Approved Upwork job-search permission"],
      };
    }
    return {
      state: "NOT_AUTHORIZED",
      message:
        "Upwork access is marked as confirmed, but the live adapter has not been implemented and verified against the granted API schema. Live discovery remains blocked.",
      missing: ["Verified Upwork job-search adapter"],
    };
  }

  getCapabilities(): SourceCapabilities {
    return { fields: [], supportsPagination: false, supportsJobDetails: false, isMock: false };
  }

  async discoverJobs(_profile: ProfileConfig, _cursor: string | null): Promise<DiscoverPage> {
    const status = await this.checkConnection();
    throw new SourceNotAuthorizedError(status.message);
  }

  normalizeJob(_sourceRecord: unknown): NormalizedJob | null {
    return null;
  }
}
