import type { DbExecutor } from "@/lib/database/client";
import { auditLogs } from "@/lib/database/schema";

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
