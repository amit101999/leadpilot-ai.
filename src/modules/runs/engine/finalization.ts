import { and, eq, inArray, isNull } from "drizzle-orm";
import { env } from "@/lib/configuration/env";
import type { Database } from "@/lib/database/client";
import { agentRuns, notificationAttempts, notifications, runStages } from "@/lib/database/schema";
import { sanitizeErrorMessage } from "@/lib/security/sanitize";
import { recordAudit } from "@/modules/audit/service";
import { buildRunSummaryMessage } from "@/modules/notifications/message";
import { getRecipientForSend } from "@/modules/notifications/recipients";
import type { Providers } from "@/modules/providers";
import type { RunStage, RunStatus } from "@/types/domain";
import { parseSnapshot } from "../snapshot";
import {
  beginStage,
  completeStage,
  loadRun,
  refreshRunCounters,
  transitionRun,
  type RunContext,
  type RunRow,
  type StageResponse,
} from "./context";
import { gate } from "./gating";

/** FINALIZATION: computes authoritative counts, settles leftovers, sets the final status. */
export async function finalizeStep(ctx: RunContext): Promise<StageResponse> {
  const blocked = await gate(ctx, "finalize");
  if (blocked) return blocked;
  const { db, run } = ctx;
  await beginStage(db, run.id, "FINALIZATION");
  const cancelled = Boolean(run.cancelRequestedAt);

  await settleUnsentNotifications(db, run.id);
  const counters = await refreshRunCounters(db, run.id);
  const hasErrors =
    counters.aiErrorCount > 0 || counters.failedNotificationCount > 0 || counters.pendingAiCount > 0;
  const status: RunStatus = cancelled ? "CANCELLED" : hasErrors ? "COMPLETED_WITH_ERRORS" : "COMPLETED";

  if (cancelled) {
    await db
      .update(runStages)
      .set({ status: "SKIPPED", updatedAt: new Date() })
      .where(
        and(
          eq(runStages.runId, run.id),
          inArray(runStages.status, ["PENDING", "RUNNING"]),
          inArray(runStages.stage, [
            "DISCOVERY",
            "HARD_FILTERS",
            "AI_EVALUATION",
            "SELECTION",
            "NOTIFICATION",
          ]),
        ),
      );
  }
  await completeStage(db, run.id, "FINALIZATION", { ...counters, finalStatus: status });
  const finished = await transitionRun(db, run.id, status, {
    finishedAt: new Date(),
    leaseOwner: null,
    leaseExpiresAt: null,
  });
  const finalRun = finished ?? (await loadRun(db, run.id));
  await recordAudit(db, {
    actor: { type: "EXECUTOR" },
    action: "run.finish",
    entityType: "agent_run",
    entityId: run.id,
    after: { status: finalRun.status, ...counters },
  });
  await maybeSendRunSummary(db, ctx.providers, finalRun);
  return { runId: run.id, step: "finalize", runStatus: finalRun.status, terminal: true, next: null };
}

/**
 * Marks a run FAILED (from the n8n error workflow or the in-process runner).
 * All successfully processed jobs, qualifications and notifications are kept.
 */
export async function failRun(
  db: Database,
  providers: Providers,
  runId: string,
  input: { stage?: RunStage | null; error: unknown; executionId?: string | null },
): Promise<RunRow> {
  const message = sanitizeErrorMessage(input.error);
  await settleUnsentNotifications(db, runId);
  if (input.stage) {
    await db
      .update(runStages)
      .set({ status: "FAILED", error: message, finishedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(runStages.runId, runId),
          eq(runStages.stage, input.stage),
          inArray(runStages.status, ["PENDING", "RUNNING"]),
        ),
      );
  }
  await refreshRunCounters(db, runId);
  const failed = await transitionRun(db, runId, "FAILED", {
    finishedAt: new Date(),
    leaseOwner: null,
    leaseExpiresAt: null,
    errorSummary: {
      code: "WORKFLOW_EXECUTION_FAILED",
      message,
      stage: input.stage ?? null,
      executionId: input.executionId ?? null,
    },
  });
  const run = failed ?? (await loadRun(db, runId));
  if (failed) {
    await recordAudit(db, {
      actor: { type: "EXECUTOR" },
      action: "run.fail",
      entityType: "agent_run",
      entityId: runId,
      after: { stage: input.stage ?? null, error: message },
    });
    await maybeSendRunSummary(db, providers, run);
  }
  return run;
}

/**
 * Reserved-but-never-attempted notifications are cancelled (releasing the
 * claim for future runs); anything caught mid-send becomes UNCERTAIN.
 */
async function settleUnsentNotifications(db: Database, runId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(and(eq(notifications.runId, runId), eq(notifications.status, "RESERVED")));
  const stuck = await db
    .update(notifications)
    .set({ status: "UNCERTAIN", lastError: "Run ended during send; delivery unknown", updatedAt: new Date() })
    .where(and(eq(notifications.runId, runId), eq(notifications.status, "SENDING")))
    .returning({ id: notifications.id });
  if (stuck.length > 0) {
    await db
      .update(notificationAttempts)
      .set({ outcome: "UNCERTAIN", finishedAt: new Date() })
      .where(
        and(
          inArray(
            notificationAttempts.notificationId,
            stuck.map((s) => s.id),
          ),
          eq(notificationAttempts.outcome, "SENDING"),
        ),
      );
  }
}

/**
 * Optional run-summary / failure alert. Sent at most once per run (guarded by
 * summary_notification being null) and never affects the run's own status.
 */
async function maybeSendRunSummary(db: Database, providers: Providers, run: RunRow): Promise<void> {
  if (run.summaryNotification) return;
  const snapshot = parseSnapshot(run.configurationSnapshot);
  const n = snapshot.configuration.notifications;
  const failed =
    run.status === "FAILED" || run.status === "COMPLETED_WITH_ERRORS" || run.status === "BLOCKED_SOURCE";
  const wanted = n.whatsappEnabled && n.recipientId && (n.sendRunSummary || (n.alertOnFailure && failed));
  if (!wanted || !n.recipientId) return;

  // Claim the summary slot first so concurrent finalizers cannot double-send.
  const [claimed] = await db
    .update(agentRuns)
    .set({ summaryNotification: { status: "SENDING", at: new Date().toISOString() } })
    .where(and(eq(agentRuns.id, run.id), isNull(agentRuns.summaryNotification)))
    .returning({ id: agentRuns.id });
  if (!claimed) return;

  const recipient = await getRecipientForSend(db, n.recipientId);
  let result: Record<string, unknown>;
  if (!recipient || !recipient.optInConfirmedAt || recipient.archivedAt) {
    result = { status: "SKIPPED", reason: "Recipient unavailable or not opted in" };
  } else {
    const message = buildRunSummaryMessage({
      status: run.status,
      discovered: run.sourceCount,
      qualified: run.qualifiedCount,
      rejected: run.rejectedCount,
      notified: run.notifiedCount,
      failedNotifications: run.failedNotificationCount,
      runUrl: `${env().APP_BASE_URL.replace(/\/$/, "")}/history/${run.id}`,
    });
    try {
      const outcome = await providers.whatsapp.send({
        to: recipient.phoneE164,
        kind: "summary",
        templateParams: message.templateParams,
        previewText: message.previewText,
        idempotencyKey: `summary-${run.id}`,
      });
      result =
        outcome.kind === "accepted"
          ? { status: "SENT", providerMessageId: outcome.providerMessageId }
          : {
              status: outcome.kind === "uncertain" ? "UNCERTAIN" : "FAILED",
              error: sanitizeErrorMessage(outcome.error),
            };
    } catch (error) {
      result = { status: "UNCERTAIN", error: sanitizeErrorMessage(error) };
    }
  }
  await db
    .update(agentRuns)
    .set({ summaryNotification: { ...result, at: new Date().toISOString() } })
    .where(eq(agentRuns.id, run.id));
}
