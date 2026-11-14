import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { ownerFilter, requireRole, type Actor } from "@/lib/auth/authorization";
import type { Database } from "@/lib/database/client";
import {
  agentRuns,
  jobs,
  notificationRecipients,
  notifications,
  searchProfiles,
} from "@/lib/database/schema";
import { AppError, notFound } from "@/lib/http/errors";
import { sanitizeErrorMessage } from "@/lib/security/sanitize";
import { recordAudit, userActor } from "@/modules/audit/service";
import type { Providers } from "@/modules/providers";
import { refreshRunCounters } from "@/modules/runs/engine/context";
import { deliverNotification } from "@/modules/runs/engine/delivery";
import { escapeLike } from "@/modules/runs/service";
import type { NotificationStatus } from "@/types/domain";
import { getRecipient } from "./recipients";
import { uncertainRetryEligibleAt } from "./retry-policy";

export { UNCERTAIN_RETRY_WAIT_MS } from "./retry-policy";

const VIEW_COLUMNS = {
  id: notifications.id,
  jobId: notifications.jobId,
  jobTitle: jobs.title,
  runId: notifications.runId,
  profileId: agentRuns.profileId,
  recipientId: notifications.recipientId,
  recipientLabel: notificationRecipients.label,
  channel: notifications.channel,
  status: notifications.status,
  providerMessageId: notifications.providerMessageId,
  attempts: notifications.attempts,
  messagePreview: notifications.messagePreview,
  reservedAt: notifications.reservedAt,
  lastAttemptAt: notifications.lastAttemptAt,
  sentAt: notifications.sentAt,
  deliveredAt: notifications.deliveredAt,
  readAt: notifications.readAt,
  lastError: notifications.lastError,
  createdAt: notifications.createdAt,
  updatedAt: notifications.updatedAt,
};

function scope(actor: Actor): SQL | undefined {
  const owner = ownerFilter(actor);
  return owner ? eq(searchProfiles.ownerUserId, owner) : undefined;
}

function baseQuery(db: Database) {
  return db
    .select(VIEW_COLUMNS)
    .from(notifications)
    .innerJoin(jobs, eq(jobs.id, notifications.jobId))
    .innerJoin(notificationRecipients, eq(notificationRecipients.id, notifications.recipientId))
    .innerJoin(agentRuns, eq(agentRuns.id, notifications.runId))
    .innerJoin(searchProfiles, eq(searchProfiles.id, agentRuns.profileId));
}

export interface NotificationListFilters {
  offset: number;
  pageSize: number;
  status?: NotificationStatus[];
  runId?: string;
  profileId?: string;
  search?: string;
}

export async function listNotifications(db: Database, actor: Actor, f: NotificationListFilters) {
  const conditions = [
    scope(actor),
    f.status?.length ? inArray(notifications.status, f.status) : undefined,
    f.runId ? eq(notifications.runId, f.runId) : undefined,
    f.profileId ? eq(agentRuns.profileId, f.profileId) : undefined,
    f.search ? sql`${jobs.title} ilike ${`%${escapeLike(f.search)}%`}` : undefined,
  ].filter((c): c is SQL => Boolean(c));
  const where = conditions.length ? and(...conditions) : undefined;
  const items = await baseQuery(db)
    .where(where)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(f.pageSize)
    .offset(f.offset);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .innerJoin(jobs, eq(jobs.id, notifications.jobId))
    .innerJoin(agentRuns, eq(agentRuns.id, notifications.runId))
    .innerJoin(searchProfiles, eq(searchProfiles.id, agentRuns.profileId))
    .where(where);
  return { items, total: total?.count ?? 0 };
}

export async function getNotification(db: Database, actor: Actor, id: string) {
  const [row] = await baseQuery(db)
    .where(and(eq(notifications.id, id), scope(actor)))
    .limit(1);
  if (!row) throw notFound("Notification");
  return row;
}

/**
 * Operator retry. FAILED_RETRYABLE: any time. FAILED_PERMANENT: re-reserved
 * first (the only transition the state machine allows), typically after the
 * cause was fixed. UNCERTAIN: only after UNCERTAIN_RETRY_WAIT_MS and with the
 * operator's explicit confirmation that the recipient did not receive it,
 * because the original may have been delivered.
 * Sent, delivered and read messages are never resent.
 */
export async function retryNotification(
  db: Database,
  providers: Providers,
  actor: Actor,
  id: string,
  input: { confirmNotReceived?: boolean },
  requestId?: string,
) {
  requireRole(actor, "OPERATOR");
  const current = await getNotification(db, actor, id);
  let claimFrom: NotificationStatus;

  if (current.status === "FAILED_RETRYABLE") {
    claimFrom = "FAILED_RETRYABLE";
  } else if (current.status === "UNCERTAIN") {
    const waitLeftMs =
      uncertainRetryEligibleAt(current.lastAttemptAt, current.updatedAt).getTime() - Date.now();
    if (waitLeftMs > 0) {
      throw new AppError(
        "INVALID_STATE",
        "The previous send may still be delivered. Wait, and check the inbox, before retrying.",
        { retryAfterSeconds: Math.ceil(waitLeftMs / 1000) },
      );
    }
    if (input.confirmNotReceived !== true) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Confirm that the recipient did not receive the message before resending it",
        [{ path: "confirmNotReceived", message: "Required for messages with an unknown delivery state" }],
      );
    }
    claimFrom = "UNCERTAIN";
  } else if (current.status === "FAILED_PERMANENT") {
    const [reserved] = await db
      .update(notifications)
      .set({ status: "RESERVED", nextAttemptAt: null, updatedAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.status, "FAILED_PERMANENT")))
      .returning({ id: notifications.id });
    if (!reserved)
      throw new AppError("CONFLICT", "The notification changed meanwhile. Reload and try again.");
    claimFrom = "RESERVED";
  } else {
    throw new AppError("INVALID_STATE", `A ${current.status} notification cannot be retried`);
  }

  await recordAudit(db, {
    actor: userActor(actor.id),
    action: "notification.retry",
    entityType: "notification",
    entityId: id,
    before: { status: current.status },
    after: { confirmNotReceived: input.confirmNotReceived === true },
    requestId,
  });

  const [row] = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
  const result = row
    ? await deliverNotification(db, providers, row, { manual: true, allowedFrom: [claimFrom] })
    : null;
  if (result === null) throw new AppError("CONFLICT", "The notification is already being processed");
  await refreshRunCounters(db, current.runId);
  return getNotification(db, actor, id);
}

/**
 * Sends a connection-test e-mail to an opted-in recipient.
 * Not a lead notification: recorded in the audit log only.
 */
export async function sendTestMessage(
  db: Database,
  providers: Providers,
  actor: Actor,
  recipientId: string,
  requestId?: string,
) {
  requireRole(actor, "OPERATOR");
  const recipient = await getRecipient(db, actor, recipientId);
  if (recipient.channel !== "EMAIL" || !recipient.email) {
    throw new AppError("VALIDATION_ERROR", "Choose an e-mail recipient");
  }
  if (recipient.archivedAt) throw new AppError("INVALID_STATE", "This recipient is archived");
  if (!recipient.optInConfirmedAt) {
    throw new AppError("INVALID_STATE", "Confirm the recipient's opt-in before sending a test");
  }
  const provider = providers.email;
  let outcome;
  try {
    outcome = await provider.send({
      to: recipient.email,
      subject: "LeadPilot AI connection test",
      text: "This is a test message from LeadPilot AI. Lead alerts will arrive at this address.",
      html: "<p>This is a test message from LeadPilot AI. Lead alerts will arrive at this address.</p>",
      idempotencyKey: `test-${randomUUID()}`,
    });
  } catch (error) {
    outcome = { kind: "uncertain" as const, error: sanitizeErrorMessage(error) };
  }
  const result =
    outcome.kind === "accepted"
      ? { status: "ACCEPTED" as const, providerMessageId: outcome.providerMessageId, error: null }
      : {
          status: outcome.kind === "rejected" ? ("REJECTED" as const) : ("UNCERTAIN" as const),
          providerMessageId: null,
          error: sanitizeErrorMessage(outcome.error),
        };
  await recordAudit(db, {
    actor: userActor(actor.id),
    action: "email.test_message",
    entityType: "notification_recipient",
    entityId: recipientId,
    after: { status: result.status, provider: provider.id },
    requestId,
  });
  // "ACCEPTED" means the provider took the request, not that the recipient received it.
  return { ...result, channel: recipient.channel, provider: provider.id, isMock: provider.isMock };
}
