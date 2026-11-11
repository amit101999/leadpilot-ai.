import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { ownerFilter, requireRole, type Actor } from "@/lib/auth/authorization";
import { env } from "@/lib/configuration/env";
import type { Database } from "@/lib/database/client";
import { importBatches, jobs, searchProfiles, stagedJobs, syncState } from "@/lib/database/schema";
import { AppError } from "@/lib/http/errors";
import { sanitizeErrorMessage } from "@/lib/security/sanitize";
import { uuidParam } from "@/lib/validation/common";
import { recordAudit, userActor } from "@/modules/audit/service";
import type { NormalizedJob } from "@/modules/job-sources/types";
import {
  normalizeUpworkMcpJob,
  parseStagedJob,
  UPWORK_SOURCE,
  upworkMcpJobSchema,
} from "@/modules/job-sources/upwork-import/normalize";
import type { ProfileConfig } from "@/modules/profiles/config-schema";
import { getProfile, parseStoredConfig } from "@/modules/profiles/service";
import type { Providers } from "@/modules/providers";
import { evaluateHardChecks, type HardRule } from "@/modules/qualification/hard-filters";
import { alreadyNotifiedJobIds } from "@/modules/runs/engine/filtering";
import { createRun } from "@/modules/runs/service";
import { syncDue } from "./schedule";

/** Limits handed to the agent so one sync stays small and inside Upwork's browse throttle. */
export const SYNC_LIMITS = {
  pagesPerSearch: 2,
  resultsPerPage: 10,
  maxDetailCalls: 15,
  maxJobsPerCommit: 100,
};

export const importJobsSchema = z.object({
  profileId: uuidParam,
  origin: z.literal("upwork-mcp"),
  // Items are validated one by one so a single malformed job is reported, not fatal.
  jobs: z.array(z.unknown()).max(SYNC_LIMITS.maxJobsPerCommit),
});
export const syncStatusSchema = z.object({
  profileId: uuidParam,
  status: z.enum(["OK", "PARTIAL", "ERROR"]),
  message: z.string().max(1000).optional(),
});

interface InvalidItem {
  index: number;
  id: string | null;
  error: string;
}

async function importableProfile(db: Database, actor: Actor, profileId: string) {
  requireRole(actor, "OPERATOR");
  const profile = await getProfile(db, actor, profileId);
  if (profile.archivedAt || !profile.active) {
    throw new AppError("INVALID_STATE", "Archived profiles cannot receive imported jobs");
  }
  return { profile, config: parseStoredConfig(profile.configuration) };
}

/** Validates and normalizes each raw item; the last copy of a repeated job id wins. */
function parseItems(items: unknown[]): { valid: NormalizedJob[]; invalid: InvalidItem[] } {
  const byId = new Map<string, NormalizedJob>();
  const invalid: InvalidItem[] = [];
  items.forEach((item, index) => {
    const parsed = upworkMcpJobSchema.safeParse(item);
    if (!parsed.success) {
      const id = (item as { id?: unknown } | null)?.id;
      invalid.push({
        index,
        id: typeof id === "string" ? id.slice(0, 64) : null,
        error: parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "job"}: ${i.message}`)
          .join("; "),
      });
      return;
    }
    const job = normalizeUpworkMcpJob(parsed.data);
    byId.set(job.sourceJobId, job);
  });
  return { valid: [...byId.values()], invalid };
}

/** Stored jobs (id + whether full details were fetched before), keyed by source job id. */
async function storedJobs(db: Database, sourceJobIds: string[]) {
  if (sourceJobIds.length === 0) return new Map<string, typeof jobs.$inferSelect>();
  const rows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.source, UPWORK_SOURCE), inArray(jobs.sourceJobId, sourceJobIds)));
  return new Map(rows.map((r) => [r.sourceJobId, r]));
}

/** What an earlier import already knew about a job (a stored job or a job still waiting in the queue). */
interface PriorCopy {
  description: string;
  clientHires: number | null;
  category: string | null;
  sourceMetadata: Record<string, unknown>;
}

/**
 * A re-import from search results must not erase details fetched earlier (full description, hires,
 * category, client record). Search data wins for everything it carries; detail-only fields are kept.
 */
function keepPriorDetails(incoming: NormalizedJob, prior: PriorCopy | undefined): NormalizedJob {
  if (incoming.sourceMetadata.detailsFetched || !prior?.sourceMetadata.detailsFetched) return incoming;
  const meta = prior.sourceMetadata;
  return {
    ...incoming,
    // Search results carry only a snippet; the earlier detail call had the full text.
    description: prior.description || incoming.description,
    clientHires: incoming.clientHires ?? prior.clientHires,
    category: incoming.category ?? prior.category,
    sourceMetadata: {
      ...incoming.sourceMetadata,
      detailsFetched: true,
      client: meta.client ?? incoming.sourceMetadata.client,
      job: meta.job ?? incoming.sourceMetadata.job,
      preferredQualifications: meta.preferredQualifications ?? null,
    },
  };
}

/** The best earlier copy of each job: a queued copy (newest) if it has details, otherwise the stored job. */
async function priorCopies(db: Database, profileId: string, sourceJobIds: string[]) {
  const priors = new Map<string, PriorCopy>();
  for (const [id, row] of await storedJobs(db, sourceJobIds)) {
    priors.set(id, { ...row, sourceMetadata: (row.sourceMetadata ?? {}) as Record<string, unknown> });
  }
  if (sourceJobIds.length === 0) return priors;
  const queued = await db
    .select({ payload: stagedJobs.payload })
    .from(stagedJobs)
    .where(
      and(
        eq(stagedJobs.profileId, profileId),
        eq(stagedJobs.status, "PENDING"),
        eq(stagedJobs.source, UPWORK_SOURCE),
        inArray(stagedJobs.sourceJobId, sourceJobIds),
      ),
    );
  for (const { payload } of queued) {
    const job = parseStagedJob(payload);
    if (job?.sourceMetadata.detailsFetched) priors.set(job.sourceJobId, job);
  }
  return priors;
}

/**
 * Rules that search results alone can decide. The others (required skills, include keywords, keyword
 * coverage, required combinations, client hires, category) need the full description or the client's
 * hiring record, which the detail call supplies, so they never reject a job at screening.
 */
const SCREENABLE_RULES = new Set<HardRule>([
  "STABLE_IDENTIFIER",
  "VALID_URL",
  "JOB_TYPE",
  "CURRENCY",
  "BUDGET",
  "PAYMENT_VERIFIED",
  "CLIENT_RATING",
  "CLIENT_SPEND",
  "CLIENT_LOCATION",
  "EXCLUDE_KEYWORDS",
]);

/** Only a definite failure of a screenable rule rejects; unknown values may be filled in by the details. */
function rejectedAtScreening(job: NormalizedJob, config: ProfileConfig): boolean {
  const { results } = evaluateHardChecks(job, config, { sourceAuthorized: true, alreadyNotified: false });
  return results.some((r) => r.effect === "REJECT" && r.outcome === "FAIL" && SCREENABLE_RULES.has(r.rule));
}

/** Profiles the agent should consider, with their search settings and whether each is due now. */
export async function getImportContext(db: Database, actor: Actor, options: { scheduled: boolean }) {
  requireRole(actor, "OPERATOR");
  const owner = ownerFilter(actor);
  const rows = await db
    .select({ profile: searchProfiles, lastSyncedAt: syncState.lastSyncedAt })
    .from(searchProfiles)
    .leftJoin(syncState, eq(syncState.profileId, searchProfiles.id))
    .where(
      and(
        owner ? eq(searchProfiles.ownerUserId, owner) : undefined,
        isNull(searchProfiles.archivedAt),
        eq(searchProfiles.active, true),
      ),
    );
  const scheduledAllowed = env().UPWORK_SYNC_SCHEDULED_ALLOWED;
  const now = new Date();
  const profiles = rows
    .map(({ profile, lastSyncedAt }) => ({
      profile,
      lastSyncedAt,
      config: parseStoredConfig(profile.configuration),
    }))
    .filter(({ config }) => config.search.upworkSync.enabled)
    .map(({ profile, lastSyncedAt, config }) => {
      let decision = syncDue(config.search, lastSyncedAt, now);
      if (options.scheduled && !scheduledAllowed) {
        decision = {
          due: false,
          reason: "Scheduled syncs are disabled (UPWORK_SYNC_SCHEDULED_ALLOWED=false)",
        };
      } else if (!options.scheduled && !decision.due && config.search.keywords.length > 0) {
        // A manual sync always runs; only the schedule respects the interval and active hours.
        decision = { due: true };
      }
      return {
        id: profile.id,
        name: profile.name,
        due: decision.due,
        reason: decision.due ? null : decision.reason,
        lastSyncedAt,
        keywords: config.search.keywords,
        filters: {
          jobType: config.budget.jobType,
          fixedMin: config.budget.fixedMin,
          hourlyMin: config.budget.hourlyMin,
          verifiedPaymentOnly: config.client.paymentVerificationRequired,
          category: config.skills.category,
        },
      };
    });
  return { scheduled: options.scheduled, scheduledAllowed, limits: SYNC_LIMITS, profiles };
}

/**
 * Screening (nothing is stored): runs the profile's hard filters on search data and returns which
 * jobs are worth a detail call. Jobs already alerted, or whose details were fetched before, are skipped.
 */
export async function screenJobs(db: Database, actor: Actor, input: z.infer<typeof importJobsSchema>) {
  const { config } = await importableProfile(db, actor, input.profileId);
  const { valid, invalid } = parseItems(input.jobs);
  const stored = await storedJobs(
    db,
    valid.map((j) => j.sourceJobId),
  );
  const notified = await alreadyNotifiedJobIds(
    db,
    config,
    [...stored.values()].map((s) => s.id),
  );

  const detailsWanted: string[] = [];
  let rejected = 0;
  for (const job of valid) {
    const row = stored.get(job.sourceJobId);
    if (row && notified.has(row.id)) {
      rejected += 1;
      continue;
    }
    if (rejectedAtScreening(job, config)) {
      rejected += 1;
      continue;
    }
    const detailsKnown = Boolean(
      (row?.sourceMetadata as { detailsFetched?: boolean } | undefined)?.detailsFetched,
    );
    if (!detailsKnown) detailsWanted.push(job.sourceJobId);
  }
  return {
    received: input.jobs.length,
    valid: valid.length,
    rejected,
    invalid,
    detailsWanted: detailsWanted.slice(0, SYNC_LIMITS.maxDetailCalls),
  };
}

/**
 * Stores the jobs for the profile (one PENDING copy per job; a re-import refreshes it) and starts an
 * import run. When a run for the profile is already active, the jobs stay queued and that run's
 * finalization starts a follow-up run for them.
 */
export async function commitJobs(
  db: Database,
  providers: Providers,
  actor: Actor,
  input: z.infer<typeof importJobsSchema>,
  requestId?: string,
) {
  const { profile } = await importableProfile(db, actor, input.profileId);
  const { valid, invalid } = parseItems(input.jobs);
  const priors = await priorCopies(
    db,
    profile.id,
    valid.map((j) => j.sourceJobId),
  );
  const toStage = valid.map((job) => keepPriorDetails(job, priors.get(job.sourceJobId)));

  const batch = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(importBatches)
      .values({
        profileId: profile.id,
        createdBy: actor.id,
        origin: input.origin,
        received: input.jobs.length,
        accepted: toStage.length,
        invalid: invalid.length,
      })
      .returning();
    for (const job of toStage) {
      await tx
        .insert(stagedJobs)
        .values({
          batchId: created!.id,
          profileId: profile.id,
          source: job.source,
          sourceJobId: job.sourceJobId,
          payload: job,
        })
        .onConflictDoUpdate({
          target: [stagedJobs.profileId, stagedJobs.source, stagedJobs.sourceJobId],
          targetWhere: eq(stagedJobs.status, "PENDING"),
          set: { batchId: created!.id, payload: job, updatedAt: new Date() },
        });
    }
    await recordAudit(tx, {
      actor: userActor(actor.id),
      action: "import.commit",
      entityType: "search_profile",
      entityId: profile.id,
      after: {
        batchId: created!.id,
        origin: input.origin,
        accepted: toStage.length,
        invalid: invalid.length,
      },
      requestId,
    });
    return created!;
  });

  let runId: string | null = null;
  let status: "STARTED" | "QUEUED" | "FAILED" | "NOTHING_TO_IMPORT" = "NOTHING_TO_IMPORT";
  let error: string | null = null;
  if (toStage.length > 0) {
    try {
      const { run } = await createRun(
        db,
        providers,
        actor,
        { profileId: profile.id, idempotencyKey: `import:${batch.id}`, jobSource: "import" },
        requestId,
      );
      runId = run.id;
      await db.update(importBatches).set({ runId }).where(eq(importBatches.id, batch.id));
      if (run.status === "FAILED") {
        // The run could not start (e.g. n8n unreachable); the jobs stay queued for the next sync or run.
        status = "FAILED";
        error =
          (run.errorSummary as { message?: string } | null)?.message ?? "The import run could not start";
      } else {
        status = "STARTED";
      }
    } catch (caught) {
      if (!(caught instanceof AppError && caught.code === "RUN_ALREADY_ACTIVE")) throw caught;
      status = "QUEUED";
    }
  }
  return {
    batchId: batch.id,
    status,
    runId,
    error,
    received: input.jobs.length,
    accepted: toStage.length,
    invalid,
  };
}

export async function recordSyncStatus(db: Database, actor: Actor, input: z.infer<typeof syncStatusSchema>) {
  await importableProfile(db, actor, input.profileId);
  const values = {
    lastSyncedAt: new Date(),
    lastStatus: input.status,
    lastError:
      input.status === "OK" ? null : sanitizeErrorMessage(input.message ?? "Sync reported a problem"),
    updatedAt: new Date(),
  };
  await db
    .insert(syncState)
    .values({ profileId: input.profileId, ...values })
    .onConflictDoUpdate({ target: syncState.profileId, set: values });
  return { profileId: input.profileId, ...values };
}
