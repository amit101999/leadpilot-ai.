import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { ownerFilter, requireRole, type Actor } from "@/lib/auth/authorization";
import { env } from "@/lib/configuration/env";
import type { Database } from "@/lib/database/client";
import { agentRuns, runStages, searchProfiles } from "@/lib/database/schema";
import { AppError, isUniqueViolation, notFound } from "@/lib/http/errors";
import { isTerminal } from "@/lib/state-machine";
import { recordAudit, userActor } from "@/modules/audit/service";
import { getCurrentVersion, getProfile } from "@/modules/profiles/service";
import type { Providers } from "@/modules/providers";
import { RUN_STAGES, type RunStatus } from "@/types/domain";
import { computeRunCounters, transitionRun, type RunRow } from "./engine/context";
import { dispatchRun, type ExecutorKind } from "./executor";
import { buildSnapshot } from "./snapshot";
import { RUN_TRANSITIONS } from "./transitions";

/**
 * Creates a run with an immutable configuration snapshot. Safe against double
 * submission: the same Idempotency-Key returns the original run, and a partial
 * unique index allows only one QUEUED/RUNNING run per profile.
 */
export async function createRun(
  db: Database,
  providers: Providers,
  actor: Actor,
  input: { profileId: string; idempotencyKey: string },
  requestId?: string,
  dispatch: typeof dispatchRun = dispatchRun,
): Promise<{ run: RunRow; created: boolean }> {
  requireRole(actor, "OPERATOR");
  const existing = await findByIdempotencyKey(db, actor.id, input.idempotencyKey);
  if (existing) return reuse(existing, input.profileId);

  const executor: ExecutorKind = env().RUN_EXECUTOR;
  let run: RunRow;
  try {
    run = await db.transaction(async (tx) => {
      const profile = await getProfile(tx, actor, input.profileId);
      if (profile.archivedAt || !profile.active) {
        throw new AppError("INVALID_STATE", "Archived profiles cannot be run. Restore the profile first.");
      }
      const version = await getCurrentVersion(tx, profile);
      const snapshot = buildSnapshot(profile, version, providers, executor);
      const [inserted] = await tx
        .insert(agentRuns)
        .values({
          profileId: profile.id,
          profileVersionId: version.id,
          requestedBy: actor.id,
          idempotencyKey: input.idempotencyKey,
          status: "QUEUED",
          executor,
          sourceProvider: providers.jobSource.id,
          configurationSnapshot: snapshot,
        })
        .returning();
      if (!inserted) throw new Error("Run insert returned no row");
      await tx.insert(runStages).values(RUN_STAGES.map((stage) => ({ runId: inserted.id, stage })));
      await recordAudit(tx, {
        actor: userActor(actor.id),
        action: "run.create",
        entityType: "agent_run",
        entityId: inserted.id,
        after: { profileId: profile.id, profileVersion: version.versionNumber, executor },
        requestId,
      });
      return inserted;
    });
  } catch (error) {
    if (isUniqueViolation(error, "runs_requester_idempotency_uq")) {
      // A concurrent request with the same key won the race.
      const winner = await findByIdempotencyKey(db, actor.id, input.idempotencyKey);
      if (winner) return reuse(winner, input.profileId);
    }
    if (isUniqueViolation(error, "runs_one_active_per_profile_uq")) {
      throw new AppError("RUN_ALREADY_ACTIVE", "A run for this profile is already queued or running");
    }
    throw error;
  }

  const dispatched = await dispatch(run.id, executor);
  if (!dispatched.ok) {
    const failed = await transitionRun(db, run.id, "FAILED", {
      finishedAt: new Date(),
      errorSummary: { code: "EXECUTOR_UNAVAILABLE", message: dispatched.error, stage: null },
    });
    return { run: failed ?? run, created: true };
  }
  return { run, created: true };
}

function reuse(run: RunRow, profileId: string) {
  if (run.profileId !== profileId) {
    throw new AppError("CONFLICT", "This Idempotency-Key was already used for a different request");
  }
  return { run, created: false };
}

async function findByIdempotencyKey(db: Database, userId: string, key: string): Promise<RunRow | null> {
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.requestedBy, userId), eq(agentRuns.idempotencyKey, key)))
    .limit(1);
  return run ?? null;
}

function runScope(actor: Actor): SQL | undefined {
  const owner = ownerFilter(actor);
  return owner
    ? sql`${agentRuns.profileId} in (select id from search_profiles where owner_user_id = ${owner})`
    : undefined;
}

export async function getRun(db: Database, actor: Actor, id: string) {
  const [row] = await db
    .select({ run: agentRuns, profileName: searchProfiles.name })
    .from(agentRuns)
    .innerJoin(searchProfiles, eq(searchProfiles.id, agentRuns.profileId))
    .where(and(eq(agentRuns.id, id), runScope(actor)))
    .limit(1);
  if (!row) throw notFound("Run");
  const stages = await db.select().from(runStages).where(eq(runStages.runId, id));
  const order = new Map(RUN_STAGES.map((s, i) => [s, i]));
  stages.sort((a, b) => (order.get(a.stage) ?? 0) - (order.get(b.stage) ?? 0));
  return { ...row.run, profileName: row.profileName, stages };
}

/** Live progress: stage rows plus counts computed from per-job records (no estimated percentages). */
export async function getRunProgress(db: Database, actor: Actor, id: string) {
  const run = await getRun(db, actor, id);
  const counters = await computeRunCounters(db, id);
  return { run, counters, terminal: isTerminal(RUN_TRANSITIONS, run.status) };
}

export const RUN_SORT_COLUMNS = {
  createdAt: agentRuns.createdAt,
  status: agentRuns.status,
  qualified: agentRuns.qualifiedCount,
  discovered: agentRuns.sourceCount,
  notified: agentRuns.notifiedCount,
} as const;

export interface RunListFilters {
  page: number;
  pageSize: number;
  offset: number;
  profileId?: string;
  status?: RunStatus[];
  from?: Date;
  to?: Date;
  minQualified?: number;
  failedOnly?: boolean;
  notificationFailures?: boolean;
  search?: string;
  sort?: keyof typeof RUN_SORT_COLUMNS;
  sortDir?: "asc" | "desc";
}

export async function listRuns(db: Database, actor: Actor, filters: RunListFilters) {
  const conditions = [
    runScope(actor),
    filters.profileId ? eq(agentRuns.profileId, filters.profileId) : undefined,
    filters.status?.length ? inArray(agentRuns.status, filters.status) : undefined,
    filters.from ? gte(agentRuns.createdAt, filters.from) : undefined,
    filters.to ? lte(agentRuns.createdAt, filters.to) : undefined,
    filters.minQualified !== undefined ? gte(agentRuns.qualifiedCount, filters.minQualified) : undefined,
    filters.failedOnly
      ? inArray(agentRuns.status, ["FAILED", "BLOCKED_SOURCE", "COMPLETED_WITH_ERRORS"])
      : undefined,
    filters.notificationFailures ? sql`${agentRuns.failedNotificationCount} > 0` : undefined,
    filters.search
      ? sql`(${agentRuns.id}::text ilike ${`${escapeLike(filters.search)}%`} or ${searchProfiles.name} ilike ${`%${escapeLike(filters.search)}%`})`
      : undefined,
  ].filter((c): c is SQL => Boolean(c));
  const where = conditions.length ? and(...conditions) : undefined;
  const column = RUN_SORT_COLUMNS[filters.sort ?? "createdAt"];
  const direction = filters.sortDir === "asc" ? asc(column) : desc(column);

  const rows = await db
    .select({
      run: agentRuns,
      profileName: searchProfiles.name,
      versionNumber: sql<number>`(${agentRuns.configurationSnapshot} -> 'profile' ->> 'versionNumber')::int`,
    })
    .from(agentRuns)
    .innerJoin(searchProfiles, eq(searchProfiles.id, agentRuns.profileId))
    .where(where)
    .orderBy(direction, desc(agentRuns.id))
    .limit(filters.pageSize)
    .offset(filters.offset);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentRuns)
    .innerJoin(searchProfiles, eq(searchProfiles.id, agentRuns.profileId))
    .where(where);
  return {
    items: rows.map((r) => ({
      ...withoutSnapshot(r.run),
      profileName: r.profileName,
      versionNumber: r.versionNumber,
      durationMs:
        r.run.startedAt && r.run.finishedAt ? r.run.finishedAt.getTime() - r.run.startedAt.getTime() : null,
    })),
    total: total?.count ?? 0,
  };
}

function withoutSnapshot(run: RunRow) {
  const { configurationSnapshot: _s, leaseOwner: _l, ...rest } = run;
  return rest;
}

/** Cancellation is cooperative: a queued run stops immediately, a running one at its next step boundary. */
export async function cancelRun(db: Database, actor: Actor, id: string, requestId?: string) {
  requireRole(actor, "OPERATOR");
  const run = await getRun(db, actor, id);
  if (isTerminal(RUN_TRANSITIONS, run.status)) {
    throw new AppError("INVALID_STATE", `Run is already ${run.status}`);
  }
  await db
    .update(agentRuns)
    .set({ cancelRequestedAt: sql`coalesce(${agentRuns.cancelRequestedAt}, now())`, updatedAt: new Date() })
    .where(eq(agentRuns.id, id));
  if (run.status === "QUEUED" && !run.startedAt) {
    // Not picked up yet (or the executor never received it): cancel directly.
    await transitionRun(db, id, "CANCELLED", {
      finishedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }
  await recordAudit(db, {
    actor: userActor(actor.id),
    action: "run.cancel",
    entityType: "agent_run",
    entityId: id,
    before: { status: run.status },
    requestId,
  });
  return getRun(db, actor, id);
}

/**
 * Re-dispatches a run whose executor died (lease expired). Every step is
 * idempotent, so processing resumes at the first incomplete stage.
 */
export async function resumeRun(db: Database, actor: Actor, id: string, requestId?: string) {
  requireRole(actor, "OPERATOR");
  const run = await getRun(db, actor, id);
  if (isTerminal(RUN_TRANSITIONS, run.status))
    throw new AppError("INVALID_STATE", `Run is already ${run.status}`);
  if (run.leaseExpiresAt && run.leaseExpiresAt.getTime() > Date.now()) {
    throw new AppError("LEASE_HELD", "The run is still being processed; try again after its lease expires");
  }
  const dispatched = await dispatchRun(id, run.executor as ExecutorKind);
  if (!dispatched.ok) throw new AppError("EXECUTOR_UNAVAILABLE", dispatched.error);
  await recordAudit(db, {
    actor: userActor(actor.id),
    action: "run.resume",
    entityType: "agent_run",
    entityId: id,
    requestId,
  });
  return getRun(db, actor, id);
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
