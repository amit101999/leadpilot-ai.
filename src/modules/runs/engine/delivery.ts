import { and, asc, eq, inArray, isNull, lte, min, or, sql } from "drizzle-orm";
import { env } from "@/lib/configuration/env";
import type { Database } from "@/lib/database/client";
import { notificationAttempts, notifications } from "@/lib/database/schema";
import { sanitizeErrorMessage } from "@/lib/security/sanitize";
import { getRecipientForSend, type RecipientRow } from "@/modules/notifications/recipients";
import type { SendOutcome } from "@/modules/notifications/provider";
import type { Providers } from "@/modules/providers";
import type { NotificationStatus } from "@/types/domain";
import {
  beginStage,
  completeStage,
  refreshRunCounters,
  updateStageMetrics,
  type RunContext,
  type StageResponse,
} from "./context";
import { gate, respond } from "./gating";

export const MAX_SEND_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30_000;

type NotificationRow = typeof notifications.$inferSelect;

/**
 * NOTIFICATION: sends reserved messages in small batches. Each message is
 * claimed (RESERVED/FAILED_RETRYABLE -> SENDING) and committed before the
 * provider call; the outcome is recorded afterwards in its own short write.
 */
export async function notifyStep(ctx: RunContext): Promise<StageResponse> {
  const blocked = await gate(ctx, "notify");
  if (blocked) return blocked;
  const { db, run } = ctx;
  await beginStage(db, run.id, "NOTIFICATION");

  const due = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.runId, run.id),
        inArray(notifications.status, ["RESERVED", "FAILED_RETRYABLE"]),
        or(isNull(notifications.nextAttemptAt), lte(notifications.nextAttemptAt, new Date())),
      ),
    )
    .orderBy(asc(notifications.reservedAt), asc(notifications.id))
    .limit(env().NOTIFY_BATCH_SIZE);

  for (const notification of due) {
    await deliverNotification(db, ctx.providers, notification, { manual: false });
  }

  const [pending] = await db
    .select({ count: sql<number>`count(*)::int`, nextAt: min(notifications.nextAttemptAt) })
    .from(notifications)
    .where(
      and(eq(notifications.runId, run.id), inArray(notifications.status, ["RESERVED", "FAILED_RETRYABLE"])),
    );
  const remaining = pending?.count ?? 0;
  const counters = await refreshRunCounters(db, run.id);
  const metrics = {
    sent: counters.notifiedCount,
    failed: counters.failedNotificationCount,
    uncertain: counters.uncertainNotificationCount,
    remaining,
  };

  if (remaining > 0) {
    await updateStageMetrics(db, run.id, "NOTIFICATION", metrics);
    const waitMs = pending?.nextAt ? Math.max(0, new Date(pending.nextAt).getTime() - Date.now()) : 0;
    return respond(ctx, "notify", "notify", { remaining, retryAfterMs: waitMs });
  }
  await completeStage(db, run.id, "NOTIFICATION", metrics);
  return respond(ctx, "notify", "finalize", { remaining: 0 });
}

/**
 * Claims and sends one notification. Used by the run pipeline and by the
 * operator retry action. Returns the resulting status, or null if the row
 * could not be claimed (already being handled elsewhere).
 */
export async function deliverNotification(
  db: Database,
  providers: Pick<Providers, "whatsapp" | "email">,
  notification: NotificationRow,
  options: { manual: boolean; allowedFrom?: NotificationStatus[] },
): Promise<NotificationStatus | null> {
  const allowedFrom = options.allowedFrom ?? ["RESERVED", "FAILED_RETRYABLE"];
  const [claimed] = await db
    .update(notifications)
    .set({
      status: "SENDING",
      attempts: sql`${notifications.attempts} + 1`,
      lastAttemptAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(notifications.id, notification.id), inArray(notifications.status, allowedFrom)))
    .returning();
  if (!claimed) return null;

  const [attempt] = await db
    .insert(notificationAttempts)
    .values({
      notificationId: claimed.id,
      runId: claimed.runId,
      attemptNumber: claimed.attempts,
      outcome: "SENDING",
      manual: options.manual,
    })
    .returning({ id: notificationAttempts.id });

  const recipient = await getRecipientForSend(db, claimed.recipientId);
  let outcome: SendOutcome;
  if (!recipient || recipient.archivedAt || !recipient.optInConfirmedAt || recipient.channel !== claimed.channel) {
    outcome = {
      kind: "rejected",
      retryable: false,
      httpStatus: null,
      error: "Recipient unavailable or not opted in",
    };
  } else {
    try {
      outcome = await sendOnChannel(providers, claimed, recipient);
    } catch (error) {
      // An unexpected exception inside the provider call may have happened after the request was sent.
      outcome = { kind: "uncertain", error: sanitizeErrorMessage(error) };
    }
  }

  const { status, update } = applyOutcome(claimed, outcome);
  await db.transaction(async (tx) => {
    await tx
      .update(notifications)
      .set({ ...update, status, updatedAt: new Date() })
      .where(and(eq(notifications.id, claimed.id), eq(notifications.status, "SENDING")));
    if (attempt) {
      await tx
        .update(notificationAttempts)
        .set({
          outcome: status,
          httpStatus: outcome.kind === "uncertain" ? null : outcome.httpStatus,
          providerMessageId: outcome.kind === "accepted" ? outcome.providerMessageId : null,
          error: outcome.kind === "accepted" ? null : sanitizeErrorMessage(outcome.error),
          finishedAt: new Date(),
        })
        .where(eq(notificationAttempts.id, attempt.id));
    }
  });
  return status;
}

/** Hands the reserved message to the provider for its channel; the payload was built at selection time. */
async function sendOnChannel(
  providers: Pick<Providers, "whatsapp" | "email">,
  claimed: NotificationRow,
  recipient: RecipientRow,
): Promise<SendOutcome> {
  if (claimed.channel === "EMAIL") {
    const payload = claimed.payload as { email?: { subject: string; text: string; html: string } };
    if (!recipient.email || !payload.email) {
      return { kind: "rejected", retryable: false, httpStatus: null, error: "E-mail recipient or message missing" };
    }
    return providers.email.send({ to: recipient.email, ...payload.email, idempotencyKey: claimed.idempotencyKey });
  }
  if (!recipient.phoneE164) {
    return { kind: "rejected", retryable: false, httpStatus: null, error: "WhatsApp recipient has no phone number" };
  }
  const payload = claimed.payload as { templateParams?: string[] };
  return providers.whatsapp.send({
    to: recipient.phoneE164,
    kind: "lead",
    templateParams: payload.templateParams ?? [],
    previewText: claimed.messagePreview,
    idempotencyKey: claimed.idempotencyKey,
    callbackData: claimed.idempotencyKey,
  });
}

function applyOutcome(
  row: NotificationRow,
  outcome: SendOutcome,
): { status: NotificationStatus; update: Partial<NotificationRow> } {
  switch (outcome.kind) {
    case "accepted":
      return {
        status: "SENT",
        update: {
          providerMessageId: outcome.providerMessageId,
          sentAt: new Date(),
          lastError: null,
          nextAttemptAt: null,
        },
      };
    case "uncertain":
      return {
        status: "UNCERTAIN",
        update: { lastError: sanitizeErrorMessage(outcome.error), nextAttemptAt: null },
      };
    case "rejected": {
      const error = sanitizeErrorMessage(outcome.error);
      if (outcome.retryable && row.attempts < MAX_SEND_ATTEMPTS) {
        const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (row.attempts - 1));
        return {
          status: "FAILED_RETRYABLE",
          update: { lastError: error, nextAttemptAt: new Date(Date.now() + delay) },
        };
      }
      return { status: "FAILED_PERMANENT", update: { lastError: error, nextAttemptAt: null } };
    }
  }
}
