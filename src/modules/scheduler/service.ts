import { eq, inArray } from "drizzle-orm";
import { requireRole, type Actor } from "@/lib/auth/authorization";
import type { Database, DbExecutor } from "@/lib/database/client";
import { syncSchedules } from "@/lib/database/schema";
import { recordAudit, userActor } from "@/modules/audit/service";
import { DEFAULT_SCHEDULE, type Schedule } from "./schema";

function toSchedule(row: typeof syncSchedules.$inferSelect): Schedule {
  return {
    enabled: row.enabled,
    everyHours: row.everyHours,
    activeFrom: row.activeFrom,
    activeTo: row.activeTo,
    timezone: row.timezone,
  };
}

/** A user's scheduler, or the default when they never saved one. */
export async function getSchedule(db: DbExecutor, ownerUserId: string): Promise<Schedule> {
  const [row] = await db
    .select()
    .from(syncSchedules)
    .where(eq(syncSchedules.ownerUserId, ownerUserId))
    .limit(1);
  return row ? toSchedule(row) : { ...DEFAULT_SCHEDULE };
}

/** Schedulers of several owners in one query; owners without a row get the default. */
export async function getSchedules(db: DbExecutor, ownerUserIds: string[]): Promise<Map<string, Schedule>> {
  const unique = [...new Set(ownerUserIds)];
  const rows = unique.length
    ? await db.select().from(syncSchedules).where(inArray(syncSchedules.ownerUserId, unique))
    : [];
  const byOwner = new Map(rows.map((row) => [row.ownerUserId, toSchedule(row)]));
  return new Map(unique.map((id) => [id, byOwner.get(id) ?? { ...DEFAULT_SCHEDULE }]));
}

/** Saves the acting user's own scheduler. It applies to whichever of their profiles is active. */
export async function updateSchedule(
  db: Database,
  actor: Actor,
  input: Schedule,
  requestId?: string,
): Promise<Schedule> {
  requireRole(actor, "OPERATOR");
  return db.transaction(async (tx) => {
    const before = await getSchedule(tx, actor.id);
    const values = { ...input, updatedBy: actor.id, updatedAt: new Date() };
    await tx
      .insert(syncSchedules)
      .values({ ownerUserId: actor.id, ...values })
      .onConflictDoUpdate({ target: syncSchedules.ownerUserId, set: values });
    await recordAudit(tx, {
      actor: userActor(actor.id),
      action: "scheduler.update",
      entityType: "sync_schedule",
      entityId: actor.id,
      before,
      after: input,
      requestId,
    });
    return input;
  });
}
