import { isDecimalString } from "@/lib/money/decimal";
import type { ProfileConfig } from "@/modules/profiles/config-schema";
import { MOCK_SCENARIOS, type MockSourceRecord } from "./mock-fixtures";
import type {
  DiscoverPage,
  JobSourceProvider,
  NormalizedJob,
  SourceCapabilities,
  SourceConnectionResult,
} from "./types";
import { SourceNotAuthorizedError } from "./types";

const PAGE_SIZE = 8;

/**
 * Development/test job source. Scenario "unauthorized" simulates a source that
 * has not granted access, exercising the BLOCKED_SOURCE path.
 */
export class MockJobSourceProvider implements JobSourceProvider {
  readonly id = "mock";

  constructor(
    private readonly scenario: string = "default",
    private readonly records?: MockSourceRecord[],
  ) {}

  async checkConnection(): Promise<SourceConnectionResult> {
    if (this.scenario === "unauthorized") {
      return { state: "NOT_AUTHORIZED", message: "Mock scenario: source access not authorized" };
    }
    return { state: "MOCK", message: `Mock job source (scenario "${this.scenario}"). No live Upwork data.` };
  }

  getCapabilities(): SourceCapabilities {
    return {
      fields: [
        "title",
        "description",
        "jobUrl",
        "budgetType",
        "budgetAmount",
        "currency",
        "paymentVerified",
        "clientRating",
        "clientHires",
        "clientTotalSpent",
        "clientCountry",
        "skills",
        "category",
        "postedAt",
      ],
      supportsPagination: true,
      supportsJobDetails: false,
      isMock: true,
    };
  }

  async discoverJobs(_profile: ProfileConfig, cursor: string | null): Promise<DiscoverPage> {
    if (this.scenario === "unauthorized") throw new SourceNotAuthorizedError("Mock scenario: not authorized");
    const feed = this.records ?? MOCK_SCENARIOS[this.scenario] ?? [];
    const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
    const page = feed.slice(offset, offset + PAGE_SIZE);
    const next = offset + PAGE_SIZE < feed.length ? String(offset + PAGE_SIZE) : null;
    return { records: page, nextCursor: next };
  }

  normalizeJob(sourceRecord: unknown): NormalizedJob | null {
    if (!sourceRecord || typeof sourceRecord !== "object") return null;
    const r = sourceRecord as MockSourceRecord;
    if (typeof r.id !== "string" || r.id.trim() === "" || typeof r.title !== "string") return null;

    const engagement = r.engagement === "fixed" ? "FIXED" : r.engagement === "hourly" ? "HOURLY" : "UNKNOWN";
    const currency = (r.amount?.currency ?? r.rate?.currency ?? null)?.toUpperCase() ?? null;
    return {
      source: this.id,
      sourceJobId: r.id.trim(),
      title: r.title.trim().slice(0, 500),
      description: (r.body ?? "").slice(0, 20000),
      jobUrl: r.link ?? null,
      budgetType: engagement,
      budgetAmount: engagement === "FIXED" ? decimal(r.amount?.value) : null,
      budgetMax: engagement === "FIXED" ? decimal(r.amount?.max) : null,
      hourlyMin: engagement === "HOURLY" ? decimal(r.rate?.min) : null,
      hourlyMax: engagement === "HOURLY" ? decimal(r.rate?.max) : null,
      currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
      paymentVerified: typeof r.client?.verified === "boolean" ? r.client.verified : null,
      clientRating: typeof r.client?.rating === "number" ? r.client.rating.toFixed(2) : null,
      clientHires: typeof r.client?.hires === "number" ? r.client.hires : null,
      clientTotalSpent: decimal(r.client?.spent),
      clientCountry: r.client?.country ?? null,
      skills: (r.tags ?? []).filter((t) => typeof t === "string").slice(0, 50),
      category: r.category ?? null,
      postedAt: r.posted ? new Date(r.posted) : null,
      sourceMetadata: r.mockAi ? { mockAi: r.mockAi, mock: true } : { mock: true },
    };
  }
}

function decimal(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" ? value.toFixed(2) : value.trim();
  return isDecimalString(text) ? text : null;
}
