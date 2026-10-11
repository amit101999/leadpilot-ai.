import { createHash } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { env } from "@/lib/configuration/env";
import { jobs, notifications, qualifications, runJobs } from "@/lib/database/schema";
import type { RiskFlag } from "@/modules/ai/output-schema";
import { buildLeadMessage } from "@/modules/notifications/message";
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

  const recipientId = config.notifications.recipientId;
  const skipReason = await notificationSkipReason(ctx, recipientId);
  if (skipReason) {
    if (ranked.length > 0) {
      await db
        .update(runJobs)
        .set({ notificationNote: skipReason })
        .where(
          inArray(
            runJobs.id,
            ranked.map((r) => r.runJobId),
          ),
        );
      await addWarning(db, run.id, {
        code: "NOTIFICATIONS_SKIPPED",
        stage: "SELECTION",
        message: skipReason,
      });
    }
    await completeStage(db, run.id, "SELECTION", {
      qualified: ranked.length,
      reserved: 0,
      skipped: skipReason,
    });
    return respond(ctx, "select", "notify");
  }

  const limit = config.notifications.maxPerRun;
  const baseUrl = env().APP_BASE_URL.replace(/\/$/, "");
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`notify:WHATSAPP:${recipientId}`}))`);
    // Claims this run already holds (resume after a crash must not exceed the limit).
    const [held] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.runId, run.id), ne(notifications.status, "CANCELLED")));
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
            eq(notifications.channel, "WHATSAPP"),
            eq(notifications.recipientId, recipientId!),
          ),
        )
        .limit(1);
      if (existing?.runId === run.id && existing.status !== "CANCELLED") {
        await tx
          .update(runJobs)
          .set({ notificationNote: "Reserved for notification" })
          .where(eq(runJobs.id, candidate.runJobId));
        continue;
      }
      if (slots <= 0) {
        overLimit += 1;
        await tx
          .update(runJobs)
          .set({ notificationNote: `Not sent: per-run notification limit of ${limit} reached` })
          .where(eq(runJobs.id, candidate.runJobId));
        continue;
      }

      const message = buildLeadMessage(
        {
          title: candidate.job.title,
          budgetAmount: candidate.job.budgetAmount,
          budgetMax: candidate.job.budgetMax,
          currency: candidate.job.currency,
          budgetType: candidate.job.budgetType,
          paymentVerified: candidate.job.paymentVerified,
          skills: (candidate.qualification.evidence as { skillMatches?: string[] }).skillMatches ?? [],
          score: candidate.score,
          reason:
            (candidate.qualification.evidence as { reasoningSummary?: string }).reasoningSummary ??
            "Meets all requirements",
          riskFlags: (candidate.qualification.riskFlags as RiskFlag[]) ?? [],
          jobUrl: candidate.job.jobUrl ?? "",
          dashboardUrl: `${baseUrl}/jobs/${candidate.jobId}`,
        },
        config.notifications.messageFormat,
      );
      const idempotencyKey = createHash("sha256")
        .update(`${run.id}:${candidate.jobId}:${recipientId}`)
        .digest("hex")
        .slice(0, 40);
      const values = {
        jobId: candidate.jobId,
        runId: run.id,
        recipientId: recipientId!,
        channel: "WHATSAPP" as const,
        status: "RESERVED" as const,
        attempts: 0,
        idempotencyKey,
        messagePreview: message.previewText,
        payload: { kind: "lead", templateParams: message.templateParams },
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
        await tx
          .update(runJobs)
          .set({ notificationNote: "Reserved for notification" })
          .where(eq(runJobs.id, candidate.runJobId));
      } else {
        claimedElsewhere += 1;
        await tx
          .update(runJobs)
          .set({
            notificationNote: "Not sent: already notified or claimed by another run for this recipient",
          })
          .where(eq(runJobs.id, candidate.runJobId));
      }
    }
    return { reserved, claimedElsewhere, overLimit };
  });

  await completeStage(db, run.id, "SELECTION", { qualified: ranked.length, limit, ...result });
  await refreshRunCounters(db, run.id);
  return respond(ctx, "select", "notify");
}

async function notificationSkipReason(ctx: RunContext, recipientId: string | null): Promise<string | null> {
  const config = ctx.snapshot.configuration;
  if (!config.notifications.whatsappEnabled)
    return "Not sent: WhatsApp notifications are disabled for this profile";
  if (!recipientId) return "Not sent: no recipient configured";
  const recipient = await getRecipientForSend(ctx.db, recipientId);
  if (!recipient || recipient.archivedAt || recipient.ownerUserId !== ctx.snapshot.profile.ownerUserId) {
    return "Not sent: recipient is unavailable";
  }
  if (!recipient.optInConfirmedAt) return "Not sent: recipient opt-in has not been confirmed";
  return null;
}
