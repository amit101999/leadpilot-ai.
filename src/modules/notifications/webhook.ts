import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/database/client";
import { notifications } from "@/lib/database/schema";
import { canTransition } from "@/lib/state-machine";
import { sanitizeErrorMessage } from "@/lib/security/sanitize";
import { recordAudit } from "@/modules/audit/service";
import { refreshRunCounters } from "@/modules/runs/engine/context";
import type { NotificationStatus } from "@/types/domain";
import { NOTIFICATION_TRANSITIONS } from "./transitions";

/**
 * WhatsApp Cloud API delivery-status webhooks
 * (entry[].changes[].value.statuses[]). Only the fields needed to advance a
 * notification are read; the raw payload (which contains phone numbers) is
 * never stored or logged.
 */

const STATUS_MAP: Record<string, NotificationStatus> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED_PERMANENT",
};

const statusSchema = z.object({
  id: z.string().min(1).max(256),
  status: z.string(),
  timestamp: z
    .string()
    .regex(/^\d{1,12}$/)
    .optional(),
  biz_opaque_callback_data: z.string().max(512).optional(),
  errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional() })).optional(),
});

const payloadSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({ statuses: z.array(z.unknown()).optional() }).loose(),
        }),
      ),
    }),
  ),
});

export interface StatusEvent {
  providerMessageId: string;
  status: NotificationStatus;
  at: Date;
  callbackData: string | null;
  error: string | null;
}

/** Extracts status events; unknown statuses and malformed entries are skipped, never thrown. */
export function parseStatusWebhook(body: unknown): StatusEvent[] {
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return [];
  const events: StatusEvent[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      for (const raw of change.value.statuses ?? []) {
        const item = statusSchema.safeParse(raw);
        if (!item.success) continue;
        const status = STATUS_MAP[item.data.status];
        if (!status) continue;
        const firstError = item.data.errors?.[0];
        events.push({
          providerMessageId: item.data.id,
          status,
          at: item.data.timestamp ? new Date(Number(item.data.timestamp) * 1000) : new Date(),
          callbackData: item.data.biz_opaque_callback_data ?? null,
          error: firstError
            ? sanitizeErrorMessage(`WhatsApp error ${firstError.code ?? ""} ${firstError.title ?? ""}`.trim())
            : null,
        });
      }
    }
  }
  return events;
}

export interface WebhookResult {
  received: number;
  applied: number;
  ignored: number;
}

/**
 * Advances notifications. A status is applied only if it is a valid forward
 * transition (statuses never move backwards); the UPDATE is conditioned on the
 * status read, so a concurrent sender or webhook cannot be overwritten.
 */
export async function applyStatusEvents(db: Database, events: StatusEvent[]): Promise<WebhookResult> {
  let applied = 0;
  const touchedRuns = new Set<string>();
  for (const event of events) {
    const match = event.callbackData
      ? or(
          eq(notifications.providerMessageId, event.providerMessageId),
          eq(notifications.idempotencyKey, event.callbackData),
        )
      : eq(notifications.providerMessageId, event.providerMessageId);
    const [current] = await db.select().from(notifications).where(match).limit(1);
    if (!current || !canTransition(NOTIFICATION_TRANSITIONS, current.status, event.status)) continue;

    const update: Partial<typeof notifications.$inferInsert> = {
      status: event.status,
      providerMessageId: current.providerMessageId ?? event.providerMessageId,
      updatedAt: new Date(),
    };
    if (event.status === "SENT") update.sentAt = current.sentAt ?? event.at;
    if (event.status === "DELIVERED") {
      update.deliveredAt = event.at;
      update.sentAt = current.sentAt ?? event.at;
    }
    if (event.status === "READ") {
      update.readAt = event.at;
      update.deliveredAt = current.deliveredAt ?? event.at;
      update.sentAt = current.sentAt ?? event.at;
    }
    if (event.status === "FAILED_PERMANENT") update.lastError = event.error ?? "Delivery failed (provider)";

    const [updated] = await db
      .update(notifications)
      .set(update)
      .where(and(eq(notifications.id, current.id), eq(notifications.status, current.status)))
      .returning({ id: notifications.id });
    if (!updated) continue;
    applied += 1;
    touchedRuns.add(current.runId);
    if (current.status === "UNCERTAIN" || event.status === "FAILED_PERMANENT") {
      await recordAudit(db, {
        actor: { type: "WEBHOOK" },
        action: current.status === "UNCERTAIN" ? "notification.reconciled" : "notification.failed",
        entityType: "notification",
        entityId: current.id,
        before: { status: current.status },
        after: { status: event.status },
      });
    }
  }
  for (const runId of touchedRuns) await refreshRunCounters(db, runId);
  return { received: events.length, applied, ignored: events.length - applied };
}
