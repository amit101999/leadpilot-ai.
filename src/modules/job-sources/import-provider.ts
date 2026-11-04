import { and, asc, eq } from "drizzle-orm";
import type { DbExecutor } from "@/lib/database/client";
import { stagedJobs } from "@/lib/database/schema";
import type { ProfileConfig } from "@/modules/profiles/config-schema";
import type { DiscoverPage, JobSourceProvider, NormalizedJob, SourceCapabilities, SourceConnectionResult } from "./types";
import { parseStagedJob } from "./upwork-import/normalize";

export const IMPORT_SOURCE_ID = "upwork-import";
const PAGE_SIZE = 50;

/**
 * Job source for runs started by an import: reads the jobs an external agent (Claude + Upwork MCP)
 * staged for the run's profile. On the first page it claims every PENDING staged job for the profile
 * by marking it CONSUMED for this run; later pages, and a resumed discovery, re-read this run's own
 * claimed jobs, which the discovery stage deduplicates.
 */
export class ImportJobSourceProvider implements JobSourceProvider {
  readonly id = IMPORT_SOURCE_ID;

  constructor(private readonly binding: { db: DbExecutor; profileId: string; runId: string } | null = null) {}

  async checkConnection(): Promise<SourceConnectionResult> {
    return { state: "CONNECTED", message: "Jobs imported by the Upwork sync agent (Claude + Upwork MCP)" };
  }

  getCapabilities(): SourceCapabilities {
    return {
      fields: [
        "title",
        "description",
        "jobUrl",
        "budgetType",
        "budgetAmount",
        "hourlyMin",
        "hourlyMax",
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
      isMock: false,
    };
  }

  async discoverJobs(_profile: ProfileConfig, cursor: string | null): Promise<DiscoverPage> {
    if (!this.binding) throw new Error("Import job source is not bound to a run");
    const { db, profileId, runId } = this.binding;
    if (cursor === null) {
      await db
        .update(stagedJobs)
        .set({ status: "CONSUMED", consumedRunId: runId, updatedAt: new Date() })
        .where(and(eq(stagedJobs.profileId, profileId), eq(stagedJobs.status, "PENDING")));
    }
    const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
    const rows = await db
      .select({ payload: stagedJobs.payload })
      .from(stagedJobs)
      .where(eq(stagedJobs.consumedRunId, runId))
      .orderBy(asc(stagedJobs.createdAt), asc(stagedJobs.id))
      .limit(PAGE_SIZE + 1)
      .offset(offset);
    const hasMore = rows.length > PAGE_SIZE;
    return {
      records: rows.slice(0, PAGE_SIZE).map((r) => r.payload),
      nextCursor: hasMore ? String(offset + PAGE_SIZE) : null,
    };
  }

  /** Payloads were validated on import; re-checked here because the stored JSON could have been edited. */
  normalizeJob(sourceRecord: unknown): NormalizedJob | null {
    return parseStagedJob(sourceRecord);
  }
}
