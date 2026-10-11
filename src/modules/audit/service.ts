import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { requireRole, type Actor } from "@/lib/auth/authorization";
import type { Database, DbExecutor } from "@/lib/database/client";
import { auditLogs, users } from "@/lib/database/schema";

export type AuditActor =
  { type: "USER"; userId: string } | { type: "SYSTEM" | "EXECUTOR" | "WEBHOOK"; userId?: null };

export interface AuditEntry {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
}

/**
 * Appends an audit record. Call inside the same transaction as the change it
 * describes so the two commit (or roll back) together. Never pass secrets or
 * phone numbers in before/after.
 */
export async function recordAudit(db: DbExecutor, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    userId: entry.actor.type === "USER" ? entry.actor.userId : null,
    actorType: entry.actor.type,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    beforeState: entry.before ?? null,
    afterState: entry.after ?? null,
    requestId: entry.requestId ?? null,
  });
}

export const userActor = (userId: string): AuditActor => ({ type: "USER", userId });

export interface AuditListFilters {
  offset: number;
  pageSize: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  userId?: string;
  from?: Date;
  to?: Date;
}

/** Audit history. ADMIN only: entries contain other users' actions and before/after configuration. */
export async function listAuditLogs(db: Database, actor: Actor, f: AuditListFilters) {
  requireRole(actor, "ADMIN");
  const conditions = [
    f.action ? eq(auditLogs.action, f.action) : undefined,
    f.entityType ? eq(auditLogs.entityType, f.entityType) : undefined,
    f.entityId ? eq(auditLogs.entityId, f.entityId) : undefined,
    f.userId ? eq(auditLogs.userId, f.userId) : undefined,
    f.from ? gte(auditLogs.createdAt, f.from) : undefined,
    f.to ? lte(auditLogs.createdAt, f.to) : undefined,
  ].filter((c): c is SQL => Boolean(c));
  const where = conditions.length ? and(...conditions) : undefined;
  const items = await db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      actorType: auditLogs.actorType,
      userId: auditLogs.userId,
      userEmail: users.email,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      beforeState: auditLogs.beforeState,
      afterState: auditLogs.afterState,
      requestId: auditLogs.requestId,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(f.pageSize)
    .offset(f.offset);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(where);
  return { items, total: total?.count ?? 0 };
}
