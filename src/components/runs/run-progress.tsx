"use client";

import { AlertTriangle, CircleCheck, CircleDashed, CircleX, Loader2, MinusCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Panel } from "@/components/ui/panel";
import { Time } from "@/components/ui/time";
import { ApiError, apiFetch } from "@/lib/http/client";
import { formatDuration, shortId, toDate } from "@/lib/ui/format";
import { usePolling } from "@/lib/ui/use-polling";
import { FunnelRail } from "./funnel-rail";

interface StageRow {
  stage: string;
  status: string;
  attempts: number;
  metrics: Record<string, unknown>;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ProgressData {
  run: {
    id: string;
    status: string;
    profileName: string;
    sourceProvider: string;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    cancelRequestedAt: string | null;
    warnings: Array<{ message?: string; stage?: string | null }>;
    errorSummary: { code?: string; message?: string; stage?: string | null } | null;
    stages: StageRow[];
  };
  counters: {
    sourceCount: number;
    hardFilterPassCount: number;
    aiEvaluatedCount: number;
    qualifiedCount: number;
    rejectedCount: number;
    notifiedCount: number;
    failedNotificationCount: number;
    pendingAiCount: number;
    aiErrorCount: number;
    needsReviewCount: number;
    pendingNotificationCount: number;
    uncertainNotificationCount: number;
  };
  terminal: boolean;
}

const STAGE_LABELS: Record<string, string> = {
  SOURCE_CHECK: "Check job source access",
  DISCOVERY: "Find jobs",
  HARD_FILTERS: "Apply rules",
  AI_EVALUATION: "Score with AI",
  SELECTION: "Rank and pick leads",
  NOTIFICATION: "Send WhatsApp alerts",
  FINALIZATION: "Finish run",
};

const STAGE_ICON: Record<string, React.ReactNode> = {
  PENDING: <CircleDashed aria-hidden className="size-4 text-muted" />,
  RUNNING: <Loader2 aria-hidden className="size-4 animate-spin text-accent" />,
  COMPLETED: <CircleCheck aria-hidden className="size-4 text-success" />,
  FAILED: <CircleX aria-hidden className="size-4 text-danger" />,
  SKIPPED: <MinusCircle aria-hidden className="size-4 text-muted" />,
};

/** Live run view: polls actual stage states and counts every 2 seconds until the run ends. */
export function RunProgress({
  runId,
  initial,
  canOperate,
}: {
  runId: string;
  initial: ProgressData;
  canOperate: boolean;
}) {
  const { data, error } = usePolling<ProgressData>(`/api/runs/${runId}/events`, {
    initial,
    isDone: (d) => d.terminal,
  });
  const { run, counters, terminal } = data ?? initial;
  const elapsed =
    toDate(run.startedAt) && (terminal ? toDate(run.finishedAt) : null)
      ? toDate(run.finishedAt)!.getTime() - toDate(run.startedAt)!.getTime()
      : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            <Link href="/run" className="hover:text-ink hover:underline">
              Run Agent
            </Link>
          </p>
          <h1 className="text-[28px] leading-tight font-semibold">Run {shortId(run.id)}</h1>
          <p className="mt-1 text-sm text-muted">
            {run.profileName}, started <Time value={run.startedAt ?? run.createdAt} />
            {elapsed !== null && <>, took {formatDuration(elapsed)}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {run.sourceProvider === "mock" && <Badge tone="warning">Mock source</Badge>}
          <span aria-live="polite">
            <StatusBadge status={run.status} />
          </span>
          {!terminal && canOperate && (
            <CancelButton runId={run.id} requested={Boolean(run.cancelRequestedAt)} />
          )}
        </div>
      </header>

      {error && (
        <p role="status" className="rounded-control bg-warning-soft px-3 py-2 text-sm text-warning">
          Progress could not be refreshed ({error.message}). Retrying automatically.
        </p>
      )}

      <Panel
        id="funnel"
        title="Results so far"
        description={terminal ? undefined : "Updates every 2 seconds."}
      >
        <div className="px-4 py-4">
          <FunnelRail
            counts={{
              discovered: counters.sourceCount,
              passedFilters: counters.hardFilterPassCount,
              evaluated: counters.aiEvaluatedCount,
              qualified: counters.qualifiedCount,
              notified: counters.notifiedCount,
            }}
          />
          <p className="tabular mt-4 text-[13px] text-muted">
            {[
              `${counters.rejectedCount} rejected`,
              `${counters.needsReviewCount} ${counters.needsReviewCount === 1 ? "needs" : "need"} review`,
              plural(counters.aiErrorCount, "AI error"),
              `${counters.pendingAiCount} waiting for AI`,
              `${plural(counters.failedNotificationCount, "alert")} failed`,
            ].join(", ")}
            {counters.uncertainNotificationCount > 0 &&
              ` (${counters.uncertainNotificationCount} with unknown delivery)`}
            .
          </p>
        </div>
      </Panel>

      {(run.errorSummary || run.warnings.length > 0) && (
        <Panel id="problems" title="Errors and warnings">
          <ul className="divide-y divide-line text-sm">
            {run.errorSummary && (
              <li className="flex gap-2 px-4 py-3 text-danger">
                <CircleX aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  {run.errorSummary.message ?? "The run failed."}
                  {run.errorSummary.stage && (
                    <span className="text-muted">
                      {" "}
                      (stage: {STAGE_LABELS[run.errorSummary.stage] ?? run.errorSummary.stage})
                    </span>
                  )}
                </span>
              </li>
            )}
            {run.warnings.map((warning, index) => (
              <li key={index} className="flex gap-2 px-4 py-3 text-warning">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>{warning.message ?? "Warning"}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel id="stages" title="Stages">
        <ol className="divide-y divide-line">
          {run.stages.map((stage) => (
            <li
              key={stage.stage}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5">{STAGE_ICON[stage.status] ?? STAGE_ICON.PENDING}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{STAGE_LABELS[stage.stage] ?? stage.stage}</p>
                  {stage.error && <p className="text-[13px] text-danger">{stage.error}</p>}
                  {/* Finalization metrics repeat the run totals shown in the funnel above. */}
                  {stage.stage !== "FINALIZATION" && <StageMetrics metrics={stage.metrics} />}
                </div>
              </div>
              <div className="flex items-center gap-3 text-[13px] text-muted">
                {stage.startedAt && (
                  <span>
                    <Time value={stage.startedAt} />
                    {stage.finishedAt &&
                      ` (${formatDuration(new Date(stage.finishedAt).getTime() - new Date(stage.startedAt).getTime())})`}
                  </span>
                )}
                {stage.attempts > 1 && <span>{stage.attempts} attempts</span>}
                <StatusBadge status={stage.status} />
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      {terminal && (
        <p className="text-sm text-muted">
          This run has finished.{" "}
          <Link href={`/history/${run.id}`} className="font-medium text-accent hover:underline">
            See every job and why it passed or failed
          </Link>
          .
        </p>
      )}
    </div>
  );
}

/** Numeric stage metrics as a short readable line (keys come from the engine). */
function StageMetrics({ metrics }: { metrics: Record<string, unknown> }) {
  const entries = Object.entries(metrics).filter(([, v]) => typeof v === "number");
  if (entries.length === 0) return null;
  return (
    <p className="tabular text-[13px] text-muted">
      {entries
        .slice(0, 6)
        .map(([key, value]) => `${humanize(key)}: ${value as number}`)
        .join(", ")}
    </p>
  );
}

function humanize(key: string): string {
  const spaced = key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\bai\b/g, "AI");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function CancelButton({ runId, requested }: { runId: string; requested: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (requested) return <Badge>Cancelling at the next step</Badge>;

  async function cancel() {
    setBusy(true);
    try {
      await apiFetch(`/api/runs/${runId}/cancel`, { method: "POST" });
      toast.success("Cancellation requested. The run stops after its current step.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The run could not be cancelled.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Cancel run
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Cancel this run?"
        description="The run stops after the step it is working on. Jobs, scores and alerts already recorded are kept."
      >
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="secondary" disabled={busy}>
              Keep running
            </Button>
          </DialogClose>
          <Button variant="danger" onClick={cancel} disabled={busy}>
            {busy ? "Cancelling…" : "Cancel run"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
