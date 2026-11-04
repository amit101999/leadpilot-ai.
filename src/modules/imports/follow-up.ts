import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@/lib/database/client";
import { importBatches, stagedJobs, users } from "@/lib/database/schema";
import { logger } from "@/lib/logging/logger";
import type { Providers } from "@/modules/providers";

/**
 * Jobs imported while a run for the same profile was active stay PENDING. When any run of that
 * profile finishes, this starts one follow-up import run for them, as the user who imported them.
 * Idempotent per finished run (idempotency key), so a re-executed finalize step cannot start two.
 */
export async function startFollowUpRunIfQueued(
  db: Database,
  providers: Providers,
  finished: { id: string; profileId: string },
): Promise<string | null> {
  const [pending] = await db
    .select({ createdBy: importBatches.createdBy, role: users.role, status: users.status })
    .from(stagedJobs)
    .innerJoin(importBatches, eq(importBatches.id, stagedJobs.batchId))
    .innerJoin(users, eq(users.id, importBatches.createdBy))
    .where(and(eq(stagedJobs.profileId, finished.profileId), eq(stagedJobs.status, "PENDING")))
    .orderBy(asc(stagedJobs.createdAt))
    .limit(1);
  if (!pending) return null;
  if (pending.status !== "ACTIVE" || pending.role === "VIEWER") {
    logger.warn(
      { profile_id: finished.profileId },
      "Queued imported jobs left pending: importing user cannot run",
    );
    return null;
  }
  // Loaded lazily: the run service depends on the engine, which calls this module.
  const { createRun } = await import("@/modules/runs/service");
  try {
    const { run } = await createRun(
      db,
      providers,
      { id: pending.createdBy, role: pending.role },
      { profileId: finished.profileId, idempotencyKey: `follow-up:${finished.id}`, jobSource: "import" },
    );
    return run.id;
  } catch (error) {
    // Another run became active first; it will pick the pending jobs up when it finishes.
    logger.warn({ profile_id: finished.profileId, err: error }, "Follow-up import run not started");
    return null;
  }
}
