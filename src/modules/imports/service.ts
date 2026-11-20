import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { ownerFilter, requireRole, type Actor } from "@/lib/auth/authorization";
import { env } from "@/lib/configuration/env";
import type { Database } from "@/lib/database/client";
import {
  agentRuns,
  importBatches,
  jobs,
  runJobs,
  searchProfiles,
  stagedJobs,
  syncState,
} from "@/lib/database/schema";
import { AppError } from "@/lib/http/errors";
import { sanitizeErrorMessage } from "@/lib/security/sanitize";
import { uuidParam } from "@/lib/validation/common";
import { recordAudit, userActor } from "@/modules/audit/service";
import type { JobPosting, NormalizedClient, NormalizedJob } from "@/modules/job-sources/types";
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
import { createRun } from "@/modules/runs/service";
import { getSchedule, getSchedules } from "@/modules/scheduler/service";
import { buildSyncOverview, scanWindow, syncDue, type SyncOverview } from "./schedule";

/** Limits handed to the agent so one sync stays small and inside Upwork's browse throttle. */
export const SYNC_LIMITS = {
  pagesPerSearch: 2,
  resultsPerPage: 10,
  /** Detail calls per sync: every screened-in job up to this ceiling (Upwork throttles job opens). */
  maxDetailCalls: 40,
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
  /** The `window.to` this sync scanned up to (from the context). Stored only for OK and PARTIAL. */
  windowEnd: z.iso.datetime({ offset: true }).optional(),
});

interface InvalidItem {
  index: number;
  id: string | null;
  error: string;
}

/**
 * Source job ids this profile has already processed in any run. Such jobs are never imported, screened
 * or scored again by the sync; another profile still sees them as new.
 */
async function seenByProfile(db: Database, profileId: string, sourceJobIds: string[]): Promise<Set<string>> {
  if (sourceJobIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ sourceJobId: jobs.sourceJobId })
    .from(runJobs)
    .innerJoin(agentRuns, eq(agentRuns.id, runJobs.runId))
    .innerJoin(jobs, eq(jobs.id, runJobs.jobId))
    .where(
      and(
        eq(agentRuns.profileId, profileId),
        eq(jobs.source, UPWORK_SOURCE),
        inArray(jobs.sourceJobId, sourceJobIds),
      ),
    );
  return new Set(rows.map((r) => r.sourceJobId));
}

/** The posting-time window of the profile's current sync, from its sync state. */
async function profileWindow(db: Database, profile: { id: string; ownerUserId: string }, now: Date) {
  const [state] = await db
    .select({ windowEnd: syncState.windowEnd })
    .from(syncState)
    .where(eq(syncState.profileId, profile.id))
    .limit(1);
  const schedule = await getSchedule(db, profile.ownerUserId);
  return scanWindow(state?.windowEnd ?? null, schedule.everyHours, now);
}

/**
 * Keeps only jobs new to this profile's current window. Dropped: jobs the profile already processed,
 * and jobs posted before the window (the server's window, never the agent's). Jobs without a posting
 * time are kept.
 */
async function newJobsOnly(
  db: Database,
  profile: { id: string; ownerUserId: string },
  valid: NormalizedJob[],
) {
  const window = await profileWindow(db, profile, new Date());
  const seen = await seenByProfile(
    db,
    profile.id,
    valid.map((j) => j.sourceJobId),
  );
  const fresh: NormalizedJob[] = [];
  let alreadySeen = 0;
  let outsideWindow = 0;
  for (const job of valid) {
    if (seen.has(job.sourceJobId)) alreadySeen += 1;
    else if (job.postedAt && job.postedAt < window.from) outsideWindow += 1;
    else fresh.push(job);
  }
  return { fresh, alreadySeen, outsideWindow };
}

async function importableProfile(db: Database, actor: Actor, profileId: string) {
  requireRole(actor, "OPERATOR");
  const profile = await getProfile(db, actor, profileId);
  if (profile.archivedAt || !profile.active) {
    throw new AppError(
      "INVALID_STATE",
      "Only the active profile receives Upwork jobs. Make this profile active first.",
    );
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
  /** Only queued copies carry these; for stored jobs the upsert keeps the stored columns. */
  posting?: JobPosting;
  client?: NormalizedClient | null;
}

/** Each posting field from the incoming copy, or the earlier copy's value where the incoming one is unknown. */
function mergePosting(incoming: JobPosting, prior: JobPosting | undefined): JobPosting {
  if (!prior) return incoming;
  const merged = { ...incoming } as Record<keyof JobPosting, unknown>;
  for (const key of Object.keys(incoming) as (keyof JobPosting)[]) merged[key] = incoming[key] ?? prior[key];
  return merged as JobPosting;
}

/**
 * A re-import from search results must not erase details fetched earlier (full description, hires,
 * category, posting details, client record). Search data wins for everything it carries; detail-only
 * fields are kept.
 */
function keepPriorDetails(incoming: NormalizedJob, prior: PriorCopy | undefined): NormalizedJob {
  if (incoming.sourceMetadata.detailsFetched || !prior?.sourceMetadata.detailsFetched) return incoming;
  return {
    ...incoming,
    // Search results carry only a snippet; the earlier detail call had the full text.
    description: prior.description || incoming.description,
    clientHires: incoming.clientHires ?? prior.clientHires,
    category: incoming.category ?? prior.category,
    posting: mergePosting(incoming.posting, prior.posting),
    client: incoming.client ?? prior.client ?? null,
    sourceMetadata: { ...incoming.sourceMetadata, detailsFetched: true },
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
  // Competition counts and the proposal band come with search results, so crowded or already
  // filled postings never cost a job-detail call.
  "ALREADY_HIRED",
  "PROPOSALS",
  "INTERVIEWING",
  "INVITES",
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
    .select({ profile: searchProfiles, lastSyncedAt: syncState.lastSyncedAt, windowEnd: syncState.windowEnd })
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
  // Each owner's scheduler decides when their (single) active profile is synced.
  const schedules = await getSchedules(
    db,
    rows.map((r) => r.profile.ownerUserId),
  );
  const profiles = rows
    .map(({ profile, lastSyncedAt, windowEnd }) => ({
      profile,
      lastSyncedAt,
      windowEnd,
      schedule: schedules.get(profile.ownerUserId)!,
      config: parseStoredConfig(profile.configuration),
    }))
    .map(({ profile, lastSyncedAt, windowEnd, schedule, config }) => {
      const target = { schedule, active: true, keywords: config.search.keywords };
      let decision = syncDue(target, lastSyncedAt, now);
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
        // Scan only jobs posted in this window; a successful sync reports `window.to` as its windowEnd.
        window: scanWindow(windowEnd, schedule.everyHours, now),
        everyHours: schedule.everyHours,
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
 * jobs are worth a detail call. Jobs this profile already processed, or posted before the scan window,
 * are skipped and never asked for.
 */
export async function screenJobs(db: Database, actor: Actor, input: z.infer<typeof importJobsSchema>) {
  const { profile, config } = await importableProfile(db, actor, input.profileId);
  const { valid, invalid } = parseItems(input.jobs);
  const { fresh, alreadySeen, outsideWindow } = await newJobsOnly(db, profile, valid);

  const detailsWanted: string[] = [];
  let rejected = 0;
  for (const job of fresh) {
    if (rejectedAtScreening(job, config)) rejected += 1;
    else detailsWanted.push(job.sourceJobId);
  }
  return {
    received: input.jobs.length,
    valid: valid.length,
    alreadySeen,
    outsideWindow,
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
  const { fresh, alreadySeen, outsideWindow } = await newJobsOnly(db, profile, valid);
  const priors = await priorCopies(
    db,
    profile.id,
    fresh.map((j) => j.sourceJobId),
  );
  const toStage = fresh.map((job) => keepPriorDetails(job, priors.get(job.sourceJobId)));

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
        alreadySeen,
        outsideWindow,
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
    alreadySeen,
    outsideWindow,
    invalid,
  };
}

/**
 * Records a sync attempt. Only a successful sync (OK or PARTIAL) moves the scan window forward, so a
 * failed sync's window is scanned again by the next one.
 */
export async function recordSyncStatus(db: Database, actor: Actor, input: z.infer<typeof syncStatusSchema>) {
  await importableProfile(db, actor, input.profileId);
  const now = new Date();
  const [state] = await db
    .select({ windowEnd: syncState.windowEnd })
    .from(syncState)
    .where(eq(syncState.profileId, input.profileId))
    .limit(1);
  let windowEnd = state?.windowEnd ?? null;
  if (input.windowEnd && input.status !== "ERROR") {
    const reported = new Date(input.windowEnd);
    // A minute of slack for clock differences between the agent and the server.
    if (reported.getTime() > now.getTime() + 60_000) {
      throw new AppError("VALIDATION_ERROR", "windowEnd cannot be in the future", [
        { path: "windowEnd", message: "Must not be later than now" },
      ]);
    }
    // A late report of an older window never moves the window backwards.
    if (!windowEnd || reported > windowEnd) windowEnd = reported;
  }
  const values = {
    lastSyncedAt: now,
    windowEnd,
    lastStatus: input.status,
    lastError:
      input.status === "OK" ? null : sanitizeErrorMessage(input.message ?? "Sync reported a problem"),
    updatedAt: now,
  };
  await db
    .insert(syncState)
    .values({ profileId: input.profileId, ...values })
    .onConflictDoUpdate({ target: syncState.profileId, set: values });
  return { profileId: input.profileId, ...values };
}

/**
 * The sync schedule of each profile the actor can see (all of them, or the listed ones), keyed by
 * profile id: interval, last sync, scanned-up-to, next sync and whether the agent stopped checking in.
 */
export async function listSyncOverviews(
  db: Database,
  actor: Actor,
  profileIds?: string[],
): Promise<Map<string, SyncOverview>> {
  if (profileIds && profileIds.length === 0) return new Map();
  const owner = ownerFilter(actor);
  const rows = await db
    .select({
      id: searchProfiles.id,
      ownerUserId: searchProfiles.ownerUserId,
      active: searchProfiles.active,
      configuration: searchProfiles.configuration,
      lastSyncedAt: syncState.lastSyncedAt,
      lastStatus: syncState.lastStatus,
      lastError: syncState.lastError,
      windowEnd: syncState.windowEnd,
    })
    .from(searchProfiles)
    .leftJoin(syncState, eq(syncState.profileId, searchProfiles.id))
    .where(
      and(
        owner ? eq(searchProfiles.ownerUserId, owner) : undefined,
        profileIds ? inArray(searchProfiles.id, profileIds) : undefined,
      ),
    );
  const now = new Date();
  const schedules = await getSchedules(
    db,
    rows.map((r) => r.ownerUserId),
  );
  return new Map(
    rows.map((row) => {
      const target = {
        schedule: schedules.get(row.ownerUserId)!,
        active: row.active,
        keywords: parseStoredConfig(row.configuration).search.keywords,
      };
      return [row.id, buildSyncOverview(target, row, now)];
    }),
  );
}
