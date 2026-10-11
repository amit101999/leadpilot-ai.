import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/lib/database/client";
import { jobs } from "@/lib/database/schema";
import type { NormalizedJob } from "@/modules/job-sources/types";

export type JobRow = typeof jobs.$inferSelect;

export function contentHash(job: NormalizedJob): string {
  const { sourceMetadata: _meta, ...content } = job;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

/**
 * Inserts or refreshes a job by its stable (source, source_job_id) identity.
 * first_seen_at is preserved; last_seen_at and content are refreshed.
 */
export async function upsertJob(
  db: DbExecutor,
  job: NormalizedJob,
): Promise<{ id: string; firstSeenAt: Date }> {
  const values = {
    source: job.source,
    sourceJobId: job.sourceJobId,
    title: job.title,
    description: job.description,
    jobUrl: job.jobUrl,
    budgetType: job.budgetType,
    budgetAmount: job.budgetAmount,
    budgetMax: job.budgetMax,
    hourlyMin: job.hourlyMin,
    hourlyMax: job.hourlyMax,
    currency: job.currency,
    paymentVerified: job.paymentVerified,
    clientRating: job.clientRating,
    clientHires: job.clientHires,
    clientTotalSpent: job.clientTotalSpent,
    clientCountry: job.clientCountry,
    skills: job.skills,
    category: job.category,
    postedAt: job.postedAt,
    sourceMetadata: job.sourceMetadata,
    contentHash: contentHash(job),
  };
  const refreshed = Object.fromEntries(
    Object.keys(values)
      .filter((key) => key !== "source" && key !== "sourceJobId")
      .map((key) => {
        const column = jobs[key as keyof typeof values];
        return [key, sql.raw(`excluded."${column.name}"`)];
      }),
  );
  const [row] = await db
    .insert(jobs)
    .values(values)
    .onConflictDoUpdate({
      target: [jobs.source, jobs.sourceJobId],
      set: { ...refreshed, lastSeenAt: sql`now()` },
    })
    .returning({ id: jobs.id, firstSeenAt: jobs.firstSeenAt });
  if (!row) throw new Error("Job upsert returned no row");
  return row;
}

export function rowToNormalized(row: JobRow): NormalizedJob {
  return {
    source: row.source,
    sourceJobId: row.sourceJobId,
    title: row.title,
    description: row.description,
    jobUrl: row.jobUrl,
    budgetType: row.budgetType,
    budgetAmount: row.budgetAmount,
    budgetMax: row.budgetMax,
    hourlyMin: row.hourlyMin,
    hourlyMax: row.hourlyMax,
    currency: row.currency,
    paymentVerified: row.paymentVerified,
    clientRating: row.clientRating,
    clientHires: row.clientHires,
    clientTotalSpent: row.clientTotalSpent,
    clientCountry: row.clientCountry,
    skills: Array.isArray(row.skills) ? (row.skills as string[]) : [],
    category: row.category,
    postedAt: row.postedAt,
    sourceMetadata: (row.sourceMetadata ?? {}) as Record<string, unknown>,
  };
}
