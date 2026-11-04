import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { ownerFilter, requireRole, type Actor } from "@/lib/auth/authorization";
import type { Database, DbExecutor } from "@/lib/database/client";
import { notificationRecipients } from "@/lib/database/schema";
import { notFound } from "@/lib/http/errors";
import { maskEmail, maskPhone } from "@/lib/security/sanitize";
import { recordAudit, userActor } from "@/modules/audit/service";

const recipientLabel = z.string().trim().min(1).max(80);
/** The user confirms the recipient has opted in to receive alerts from this business on this channel. */
const optInConfirmed = z.boolean();

/** A body without `channel` is a WhatsApp recipient (the original API shape). */
export const createRecipientSchema = z.union([
  z.object({
    channel: z.literal("EMAIL"),
    label: recipientLabel,
    email: z.email("Enter a valid e-mail address").trim().toLowerCase().max(254),
    optInConfirmed,
  }),
  z.object({
    channel: z.literal("WHATSAPP").default("WHATSAPP"),
    label: recipientLabel,
    phoneE164: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{6,14}$/, "Use international E.164 format, e.g. +14155550123"),
    optInConfirmed,
  }),
]);

export const updateRecipientSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  optInConfirmed: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export type RecipientRow = typeof notificationRecipients.$inferSelect;

/** Public view: the full phone number or e-mail address never leaves the server after creation. */
export function toRecipientView(row: RecipientRow) {
  return {
    id: row.id,
    label: row.label,
    channel: row.channel,
    phoneMasked: row.phoneE164 ? maskPhone(row.phoneE164) : null,
    emailMasked: row.email ? maskEmail(row.email) : null,
    optInConfirmedAt: row.optInConfirmedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
  };
}
export type RecipientView = ReturnType<typeof toRecipientView>;

function scoped(actor: Actor, id: string) {
  const owner = ownerFilter(actor);
  return owner
    ? and(eq(notificationRecipients.id, id), eq(notificationRecipients.ownerUserId, owner))
    : eq(notificationRecipients.id, id);
}

export async function listRecipients(db: Database, actor: Actor, includeArchived = false) {
  const owner = ownerFilter(actor);
  const rows = await db
    .select()
    .from(notificationRecipients)
    .where(
      and(
        owner ? eq(notificationRecipients.ownerUserId, owner) : undefined,
        includeArchived ? undefined : isNull(notificationRecipients.archivedAt),
      ),
    )
    .orderBy(notificationRecipients.label);
  return rows.map(toRecipientView);
}

export async function getRecipientForSend(db: DbExecutor, id: string): Promise<RecipientRow | null> {
  const [row] = await db
    .select()
    .from(notificationRecipients)
    .where(eq(notificationRecipients.id, id))
    .limit(1);
  return row ?? null;
}

export async function getRecipient(db: DbExecutor, actor: Actor, id: string): Promise<RecipientRow> {
  const [row] = await db.select().from(notificationRecipients).where(scoped(actor, id)).limit(1);
  if (!row) throw notFound("Recipient");
  return row;
}

export async function createRecipient(
  db: Database,
  actor: Actor,
  input: z.infer<typeof createRecipientSchema>,
  requestId?: string,
): Promise<RecipientView> {
  requireRole(actor, "OPERATOR");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(notificationRecipients)
      .values({
        ownerUserId: actor.id,
        label: input.label,
        channel: input.channel,
        phoneE164: input.channel === "WHATSAPP" ? input.phoneE164 : null,
        email: input.channel === "EMAIL" ? input.email : null,
        optInConfirmedAt: input.optInConfirmed ? new Date() : null,
      })
      .returning();
    await recordAudit(tx, {
      actor: userActor(actor.id),
      action: "recipient.create",
      entityType: "notification_recipient",
      entityId: row!.id,
      after: { label: input.label, channel: input.channel, optInConfirmed: input.optInConfirmed },
      requestId,
    });
    return toRecipientView(row!);
  });
}

export async function updateRecipient(
  db: Database,
  actor: Actor,
  id: string,
  input: z.infer<typeof updateRecipientSchema>,
  requestId?: string,
): Promise<RecipientView> {
  requireRole(actor, "OPERATOR");
  return db.transaction(async (tx) => {
    const current = await getRecipient(tx, actor, id);
    const [row] = await tx
      .update(notificationRecipients)
      .set({
        label: input.label ?? current.label,
        optInConfirmedAt:
          input.optInConfirmed === undefined
            ? current.optInConfirmedAt
            : input.optInConfirmed
              ? (current.optInConfirmedAt ?? new Date())
              : null,
        archivedAt: input.archived === undefined ? current.archivedAt : input.archived ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(notificationRecipients.id, id))
      .returning();
    await recordAudit(tx, {
      actor: userActor(actor.id),
      action: "recipient.update",
      entityType: "notification_recipient",
      entityId: id,
      before: {
        label: current.label,
        optIn: Boolean(current.optInConfirmedAt),
        archived: Boolean(current.archivedAt),
      },
      after: { label: row!.label, optIn: Boolean(row!.optInConfirmedAt), archived: Boolean(row!.archivedAt) },
      requestId,
    });
    return toRecipientView(row!);
  });
}
