import { createHash } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { env } from "@/lib/configuration/env";
import { jobs, notifications, qualifications, runJobs } from "@/lib/database/schema";
import type { RiskFlag } from "@/modules/ai/output-schema";
import { enabledChannels, type ChannelTarget, type NotificationChannel } from "@/modules/notifications/channels";
import { buildLeadEmail, buildLeadMessage } from "@/modules/notifications/message";
import { getRecipientForSend } from "@/modules/notifications/recipients";
import { RECLAIMABLE_NOTIFICATION_STATUSES } from "@/modules/notifications/transitions";
import { rankCandidates } from "@/modules/qualification/ranking";
import {
  addWarning,
  beginStage,
  completeStage,
  refreshRunCounters,
  type RunContext,
  type StageResponse,
} from "./context";
import { gate, respond } from "./gating";

/**
 * SELECTION: ranks qualified jobs and atomically reserves up to the per-run
 * notification limit.
 *
 * Concurrency: reservations for a recipient are serialized with a transaction-
 * scoped advisory lock, and each claim is an INSERT ... ON CONFLICT on the
 * (job, channel, recipient) unique key that only takes over rows in a terminal
 * failure state. Two concurrent runs therefore can never both claim the same
 * job for the same recipient, and a run never exceeds its own limit.
 */
export async function selectStep(ctx: RunContext): Promise<StageResponse> {
  const blocked = await gate(ctx, "select");
  if (blocked) return blocked;
  const { db, run, snapshot } = ctx;
  const config = snapshot.configuration;
  await beginStage(db, run.id, "SELECTION");

  const qualified = await db
    .select({
      runJobId: runJobs.id,
      jobId: jobs.id,
      sourceJobId: jobs.sourceJobId,
      firstSeenAt: jobs.firstSeenAt,
      score: qualifications.score,
      job: jobs,
      qualification: qualifications,
    })
    .from(runJobs)
    .innerJoin(jobs, eq(jobs.id, runJobs.jobId))
    .innerJoin(
      qualifications,
      and(eq(qualifications.runId, runJobs.runId), eq(qualifications.jobId, runJobs.jobId)),
    )
    .where(and(eq(runJobs.runId, run.id), eq(runJobs.processingStatus, "QUALIFIED")));

  const ranked = rankCandidates(qualified.map((q) => ({ ...q, id: q.runJobId, score: q.score ?? 0 })));
  for (const [index, candidate] of ranked.entries()) {
    await db
      .update(runJobs)
      .set({ rank: index + 1 })
      .where(eq(runJobs.id, candidate.runJobId));
  }

  const targets = enabledChannels(config);
  // Per candidate and channel: why it was or was not reserved. Joined into one note per job at the end.
  const notes = new Map<string, Map<NotificationChannel, string>>();
  const note = (runJobId: string, channel: NotificationChannel, text: string) => {
    if (!notes.has(runJobId)) notes.set(runJobId, new Map());
    notes.get(runJobId)!.set(channel, text);
  };

  const limit = config.notifications.maxPerRun;
  const metrics: Record<string, unknown> = { qualified: ranked.length, limit };
  // Whole-channel skips (disabled, recipient unavailable, no opt-in) become run warnings.
  const skipWarnings: string[] = [];
  if (targets.length === 0) {
    const reason = "Not sent: notifications are disabled for this profile";
    for (const c of ranked) note(c.runJobId, "WHATSAPP", reason);
    metrics.skipped = reason;
    skipWarnings.push(reason);
  }

  const baseUrl = env().APP_BASE_URL.replace(/\/$/, "");
  for (const target of targets) {
    const skipReason = await notificationSkipReason(ctx, target);
    if (skipReason) {
      for (const c of ranked) note(c.runJobId, target.channel, skipReason);
      metrics[target.channel] = { reserved: 0, skipped: skipReason };
      skipWarnings.push(targets.length > 1 ? `${CHANNEL_LABEL[target.channel]}: ${skipReason}` : skipReason);
      continue;
    }
    metrics[target.channel] = await reserveForChannel(ctx, target, ranked, limit, baseUrl, note);
  }

  for (const [runJobId, byChannel] of notes) {
    await db
      .update(runJobs)
      .set({ notificationNote: joinNotes(byChannel) })
      .where(eq(runJobs.id, runJobId));
  }
  if (ranked.length > 0) {
    for (const message of skipWarnings) {
      await addWarning(db, run.id, { code: "NOTIFICATIONS_SKIPPED", stage: "SELECTION", message });
    }
  }

  await completeStage(db, run.id, "SELECTION", metrics);
  await refreshRunCounters(db, run.id);
  return respond(ctx, "select", "notify");
}

type Ranked = Array<{
  runJobId: string;
  jobId: string;
  score: number | null;
  job: typeof jobs.$inferSelect;
  qualification: typeof qualifications.$inferSelect;
}>;

/** Reserves up to `limit` claims on one channel; serialized per recipient with an advisory lock. */
async function reserveForChannel(
  ctx: RunContext,
  target: ChannelTarget,
  ranked: Ranked,
  limit: number,
  baseUrl: string,
  note: (runJobId: string, channel: NotificationChannel, text: string) => void,
) {
  const { db, run, snapshot } = ctx;
  const config = snapshot.configuration;
  const { channel, recipientId } = target;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`notify:${channel}:${recipientId}`}))`);
    // Claims this run already holds on this channel (resume after a crash must not exceed the limit).
    const [held] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.runId, run.id),
          eq(notifications.channel, channel),
          ne(notifications.status, "CANCELLED"),
        ),
      );
    let slots = limit - (held?.count ?? 0);
    let reserved = 0;
    let claimedElsewhere = 0;
    let overLimit = 0;

    for (const candidate of ranked) {
      const [existing] = await tx
        .select({ runId: notifications.runId, status: notifications.status })
        .from(notifications)
        .where(
          and(
            eq(notifications.jobId, candidate.jobId),
            eq(notifications.channel, channel),
            eq(notifications.recipientId, recipientId),
          ),
        )
        .limit(1);
      if (existing?.runId === run.id && existing.status !== "CANCELLED") {
        note(candidate.runJobId, channel, "Reserved for notification");
        continue;
      }
      if (slots <= 0) {
        overLimit += 1;
        note(candidate.runJobId, channel, `Not sent: per-run notification limit of ${limit} reached`);
        continue;
      }

      const input = {
        title: candidate.job.title,
        budgetAmount: candidate.job.budgetAmount,
        budgetMax: candidate.job.budgetMax,
        currency: candidate.job.currency,
        budgetType: candidate.job.budgetType,
        paymentVerified: candidate.job.paymentVerified,
        skills: (candidate.qualification.evidence as { skillMatches?: string[] }).skillMatches ?? [],
        score: candidate.score ?? 0,
        reason:
          (candidate.qualification.evidence as { reasoningSummary?: string }).reasoningSummary ??
          "Meets all requirements",
        riskFlags: (candidate.qualification.riskFlags as RiskFlag[]) ?? [],
        jobUrl: candidate.job.jobUrl ?? "",
        dashboardUrl: `${baseUrl}/jobs/${candidate.jobId}`,
      };
      const message = buildLeadMessage(input, config.notifications.messageFormat);
      const payload =
        channel === "EMAIL"
          ? { kind: "lead", email: buildLeadEmail(input, config.notifications.messageFormat) }
          : { kind: "lead", templateParams: message.templateParams };
      // WhatsApp keys keep their original form so claims made before e-mail existed stay recognisable.
      const keySource =
        channel === "WHATSAPP"
          ? `${run.id}:${candidate.jobId}:${recipientId}`
          : `${run.id}:${candidate.jobId}:${recipientId}:${channel}`;
      const idempotencyKey = createHash("sha256").update(keySource).digest("hex").slice(0, 40);
      const values = {
        jobId: candidate.jobId,
        runId: run.id,
        recipientId,
        channel,
        status: "RESERVED" as const,
        attempts: 0,
        idempotencyKey,
        messagePreview: message.previewText,
        payload,
        reservedAt: new Date(),
        nextAttemptAt: null,
        lastError: null,
        providerMessageId: null,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        updatedAt: new Date(),
      };
      const claimed = await tx
        .insert(notifications)
        .values(values)
        .onConflictDoUpdate({
          target: [notifications.jobId, notifications.channel, notifications.recipientId],
          set: values,
          // Only a terminally failed or cancelled claim may be taken over.
          setWhere: inArray(notifications.status, [...RECLAIMABLE_NOTIFICATION_STATUSES]),
        })
        .returning({ id: notifications.id });

      if (claimed.length > 0) {
        slots -= 1;
        reserved += 1;
        note(candidate.runJobId, channel, "Reserved for notification");
      } else {
        claimedElsewhere += 1;
        note(
          candidate.runJobId,
          channel,
          "Not sent: already notified or claimed by another run for this recipient",
        );
      }
    }
    return { reserved, claimedElsewhere, overLimit };
  });
}

const CHANNEL_LABEL: Record<NotificationChannel, string> = { WHATSAPP: "WhatsApp", EMAIL: "E-mail" };

/** One channel keeps the original wording; several are prefixed so each outcome stays readable. */
function joinNotes(byChannel: Map<NotificationChannel, string>): string {
  if (byChannel.size === 1) return [...byChannel.values()][0]!;
  return [...byChannel.entries()].map(([channel, text]) => `${CHANNEL_LABEL[channel]}: ${text}`).join("; ");
}

async function notificationSkipReason(ctx: RunContext, target: ChannelTarget): Promise<string | null> {
  const recipient = await getRecipientForSend(ctx.db, target.recipientId);
  if (
    !recipient ||
    recipient.archivedAt ||
    recipient.channel !== target.channel ||
    recipient.ownerUserId !== ctx.snapshot.profile.ownerUserId
  ) {
    return "Not sent: recipient is unavailable";
  }
  if (!recipient.optInConfirmedAt) return "Not sent: recipient opt-in has not been confirmed";
  return null;
}
