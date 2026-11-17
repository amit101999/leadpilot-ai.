import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/lib/database/client";
import { jobs } from "@/lib/database/schema";
import { rowToClient, upsertClient, type ClientRow } from "@/modules/clients/repository";
import type { NormalizedJob, PreferredQualifications } from "@/modules/job-sources/types";

export type JobRow = typeof jobs.$inferSelect;

/** Hash of the posting's content; volatile activity counts and the client record are left out. */
function contentHash(job: NormalizedJob): string {
  const { sourceMetadata: _meta, posting: _posting, client: _client, ...content } = job;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

/**
 * Columns only a job-detail call (or a richer search row) supplies. A later import that lacks them
 * keeps the stored values instead of erasing them.
 */
const KEEP_WHEN_MISSING = new Set([
  "clientId",
  "subcategory",
  "experienceLevel",
  "duration",
  "workload",
  "personsToHire",
  "proposalsTier",
  "connectsCost",
  "featured",
  "invitesSent",
  "interviewing",
  "offersMade",
  "hiresMade",
  "workflowStatus",
  "preferredQualifications",
  "detailsFetchedAt",
]);

/**
 * Inserts or refreshes a job by its stable (source, source_job_id) identity, together with its
 * client when the source identified one. first_seen_at is preserved; last_seen_at and content are
 * refreshed.
 */
export async function upsertJob(
  db: DbExecutor,
  job: NormalizedJob,
): Promise<{ id: string; firstSeenAt: Date }> {
  const clientId = job.client ? await upsertClient(db, job.source, job.client) : null;
  const { posting } = job;
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
    clientId,
    subcategory: posting.subcategory,
    experienceLevel: posting.experienceLevel,
    duration: posting.duration,
    workload: posting.workload,
    personsToHire: posting.personsToHire,
    proposalsTier: posting.proposalsTier,
    connectsCost: posting.connectsCost,
    featured: posting.featured,
    invitesSent: posting.invitesSent,
    interviewing: posting.interviewing,
    offersMade: posting.offersMade,
    hiresMade: posting.hiresMade,
    workflowStatus: posting.workflowStatus,
    preferredQualifications: posting.preferredQualifications,
    detailsFetchedAt: posting.detailsFetchedAt,
    sourceMetadata: job.sourceMetadata,
    contentHash: contentHash(job),
  };
  const refreshed = Object.fromEntries(
    Object.keys(values)
      .filter((key) => key !== "source" && key !== "sourceJobId")
      .map((key) => {
        const column = jobs[key as keyof typeof values].name;
        const value = KEEP_WHEN_MISSING.has(key)
          ? `coalesce(excluded."${column}", "jobs"."${column}")`
          : `excluded."${column}"`;
        return [key, sql.raw(value)];
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

/** A stored job (and its client row, when linked) as the provider-neutral record. */
export function rowToNormalized(row: JobRow, client: ClientRow | null = null): NormalizedJob {
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
    posting: {
      subcategory: row.subcategory,
      experienceLevel: row.experienceLevel,
      duration: row.duration,
      workload: row.workload,
      personsToHire: row.personsToHire,
      proposalsTier: row.proposalsTier,
      connectsCost: row.connectsCost,
      featured: row.featured,
      invitesSent: row.invitesSent,
      interviewing: row.interviewing,
      offersMade: row.offersMade,
      hiresMade: row.hiresMade,
      workflowStatus: row.workflowStatus,
      preferredQualifications: (row.preferredQualifications as PreferredQualifications | null) ?? null,
      detailsFetchedAt: row.detailsFetchedAt,
    },
    client: client ? rowToClient(client) : null,
    sourceMetadata: (row.sourceMetadata ?? {}) as Record<string, unknown>,
  };
}
