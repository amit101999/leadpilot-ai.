import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/database/client";
import { importBatches, stagedJobs, users } from "@/lib/database/schema";
import { logger } from "@/lib/logging/logger";
import { getProviders, type Providers } from "@/modules/providers";
import type { RunStatus } from "@/types/domain";

interface EndedRun {
  id: string;
  profileId: string;
  status: RunStatus;
  idempotencyKey: string;
}

const FOLLOW_UP_PREFIX = "follow-up:";

/**
 * Called whenever a run reaches a terminal status (finished, failed or cancelled). Imported jobs must
 * never be stranded:
 *  1. a run that did not complete gives back the staged jobs it had claimed (they become PENDING again);
 *  2. any PENDING jobs of the profile get one follow-up import run.
 * A cancelled run starts nothing (the user asked to stop). A follow-up that itself fails releases its
 * jobs but starts no further run, so a persistent error cannot loop; in both cases the next sync or
 * manual run picks the jobs up.
 */
export async function afterRunEnded(db: Database, providers: Providers | null, run: EndedRun) {
  const completed = run.status === "COMPLETED" || run.status === "COMPLETED_WITH_ERRORS";
  if (!completed) await releaseClaimedJobs(db, run.id);
  if (run.status === "CANCELLED") return null;
  if (run.status === "FAILED" && run.idempotencyKey.startsWith(FOLLOW_UP_PREFIX)) {
    logger.warn({ run_id: run.id }, "Follow-up import run failed; its jobs wait for the next sync");
    return null;
  }
  return startFollowUpRunIfQueued(db, providers ?? getProviders(), run);
}

/** Staged jobs claimed by a run that did not complete go back to PENDING (dropping duplicates already pending). */
export async function releaseClaimedJobs(db: Database, runId: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      delete from ${stagedJobs} c
      where c.consumed_run_id = ${runId}
        and exists (
          select 1 from ${stagedJobs} p
          where p.profile_id = c.profile_id and p.source = c.source
            and p.source_job_id = c.source_job_id and p.status = 'PENDING')`);
    await tx
      .update(stagedJobs)
      .set({ status: "PENDING", consumedRunId: null, updatedAt: new Date() })
      .where(eq(stagedJobs.consumedRunId, runId));
  });
}

/**
 * Starts one import run for the profile's PENDING staged jobs, as the most recent importing user who
 * can still run it. Idempotent per ended run (idempotency key), so a re-executed step cannot start two.
 */
export async function startFollowUpRunIfQueued(
  db: Database,
  providers: Providers,
  ended: { id: string; profileId: string },
): Promise<string | null> {
  const pending = and(eq(stagedJobs.profileId, ended.profileId), eq(stagedJobs.status, "PENDING"));
  const [importer] = await db
    .select({ id: users.id, role: users.role })
    .from(stagedJobs)
    .innerJoin(importBatches, eq(importBatches.id, stagedJobs.batchId))
    .innerJoin(users, eq(users.id, importBatches.createdBy))
    .where(and(pending, eq(users.status, "ACTIVE"), inArray(users.role, ["OPERATOR", "ADMIN"])))
    .orderBy(desc(stagedJobs.createdAt))
    .limit(1);
  if (!importer) {
    const [waiting] = await db.select({ id: stagedJobs.id }).from(stagedJobs).where(pending).limit(1);
    if (waiting) {
      logger.warn(
        { profile_id: ended.profileId },
        "Queued imported jobs left pending: no importing user can run",
      );
    }
    return null;
  }
  // Loaded lazily: the run service depends on the engine, which calls this module.
  const { createRun } = await import("@/modules/runs/service");
  try {
    const { run } = await createRun(db, providers, importer, {
      profileId: ended.profileId,
      idempotencyKey: `${FOLLOW_UP_PREFIX}${ended.id}`,
      jobSource: "import",
    });
    return run.id;
  } catch (error) {
    // Another run became active first; it will pick the pending jobs up when it ends.
    logger.warn({ profile_id: ended.profileId, err: error }, "Follow-up import run not started");
    return null;
  }
}
