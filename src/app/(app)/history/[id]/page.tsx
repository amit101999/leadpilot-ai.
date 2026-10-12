import { AlertTriangle, CircleX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RunJobsTabs, type RunJob } from "@/components/history/run-jobs-tabs";
import { ProfileSummary } from "@/components/profiles/profile-summary";
import { FunnelRail } from "@/components/runs/funnel-rail";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, Panel } from "@/components/ui/panel";
import { Time } from "@/components/ui/time";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/database/client";
import { AppError } from "@/lib/http/errors";
import { isTerminal } from "@/lib/state-machine";
import { formatDuration, shortId } from "@/lib/ui/format";
import { uuidParam } from "@/lib/validation/common";
import { listRunJobs } from "@/modules/jobs/queries";
import { listNotifications } from "@/modules/notifications/service";
import { getRun } from "@/modules/runs/service";
import { runSnapshotSchema } from "@/modules/runs/snapshot";
import { RUN_TRANSITIONS } from "@/modules/runs/transitions";

export const metadata: Metadata = { title: "Run details" };

const STAGE_LABELS: Record<string, string> = {
  SOURCE_CHECK: "Check job source access",
  DISCOVERY: "Find jobs",
  HARD_FILTERS: "Apply rules",
  AI_EVALUATION: "Score with AI",
  SELECTION: "Rank and pick leads",
  NOTIFICATION: "Send WhatsApp alerts",
  FINALIZATION: "Finish run",
};

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireUser();
  const parsed = uuidParam.safeParse((await params).id);
  if (!parsed.success) notFound();
  const db = getDb();
  let run;
  try {
    run = await getRun(db, actor, parsed.data);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const [jobs, notifications] = await Promise.all([
    listRunJobs(db, actor, run.id) as Promise<unknown> as Promise<RunJob[]>,
    listNotifications(db, actor, { runId: run.id, offset: 0, pageSize: 100 }),
  ]);
  const snapshot = runSnapshotSchema.safeParse(run.configurationSnapshot);
  const finished = isTerminal(RUN_TRANSITIONS, run.status);
  const duration =
    run.startedAt && run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null;
  const warnings = (run.warnings as Array<{ message?: string }> | null) ?? [];
  const errorSummary = run.errorSummary as { message?: string; stage?: string | null } | null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            <Link href="/history" className="hover:text-ink hover:underline">
              Search History
            </Link>
          </p>
          <h1 className="text-[28px] leading-tight font-semibold">Run {shortId(run.id)}</h1>
          <p className="mt-1 text-sm text-muted">
            {run.profileName}
            {snapshot.success && `, configuration version ${snapshot.data.profile.versionNumber}`}, started{" "}
            <Time value={run.startedAt ?? run.createdAt} />
            {duration !== null && `, took ${formatDuration(duration)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {run.sourceProvider === "mock" && <Badge tone="warning">Mock source</Badge>}
          <StatusBadge status={run.status} />
          {!finished && (
            <Link href={`/run/${run.id}`} className="text-[13px] font-medium text-accent hover:underline">
              Watch live
            </Link>
          )}
        </div>
      </header>

      <Panel id="funnel" title="Results">
        <div className="px-4 py-4">
          <FunnelRail
            counts={{
              discovered: run.sourceCount,
              passedFilters: run.hardFilterPassCount,
              evaluated: run.aiEvaluatedCount,
              qualified: run.qualifiedCount,
              notified: run.notifiedCount,
            }}
          />
        </div>
      </Panel>

      {(errorSummary || warnings.length > 0) && (
        <Panel id="problems" title="Errors and warnings">
          <ul className="divide-y divide-line text-sm">
            {errorSummary && (
              <li className="flex gap-2 px-4 py-3 text-danger">
                <CircleX aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  {errorSummary.message ?? "The run failed."}
                  {errorSummary.stage && (
                    <span className="text-muted">
                      {" "}
                      (stage: {STAGE_LABELS[errorSummary.stage] ?? errorSummary.stage})
                    </span>
                  )}
                </span>
              </li>
            )}
            {warnings.map((warning, index) => (
              <li key={index} className="flex gap-2 px-4 py-3 text-warning">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>{warning.message ?? "Warning"}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        id="jobs"
        title="Jobs"
        description="Every job this run looked at, with the reasons for its outcome."
      >
        <RunJobsTabs jobs={jobs} />
      </Panel>

      <Panel
        id="notifications"
        title="WhatsApp alerts"
        description="Sent means WhatsApp accepted the message; delivered and read come from WhatsApp status updates."
      >
        {notifications.items.length === 0 ? (
          <EmptyState title="No alerts were reserved in this run" />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="tabular w-full text-left text-[13px]">
              <caption className="sr-only">WhatsApp alerts for this run</caption>
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2 font-medium">
                    Job
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Recipient
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Attempts
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Sent
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Last error
                  </th>
                </tr>
              </thead>
              <tbody>
                {notifications.items.map((n) => (
                  <tr key={n.id} className="border-b border-line last:border-0">
                    <td className="max-w-64 px-4 py-2">
                      <Link href={`/jobs/${n.jobId}`} className="hover:text-accent hover:underline">
                        {n.jobTitle}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{n.recipientLabel}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={n.status} />
                    </td>
                    <td className="px-4 py-2 text-right">{n.attempts}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Time value={n.sentAt} />
                    </td>
                    <td className="max-w-64 px-4 py-2 text-muted">{n.lastError ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel id="stages" title="Stages">
        <ol className="divide-y divide-line">
          {run.stages.map((stage) => (
            <li
              key={stage.stage}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]"
            >
              <span className="font-medium">{STAGE_LABELS[stage.stage] ?? stage.stage}</span>
              <span className="flex items-center gap-3 text-muted">
                {stage.startedAt && (
                  <span>
                    <Time value={stage.startedAt} />
                    {stage.finishedAt &&
                      ` (${formatDuration(stage.finishedAt.getTime() - stage.startedAt.getTime())})`}
                  </span>
                )}
                {stage.attempts > 1 && <span>{stage.attempts} attempts</span>}
                {stage.error && <span className="text-danger">{stage.error}</span>}
                <StatusBadge status={stage.status} />
              </span>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel
        id="snapshot"
        title="Settings used by this run"
        description="Frozen when the run started. Later edits to the profile do not change this record."
      >
        {snapshot.success ? (
          <>
            <ProfileSummary config={snapshot.data.configuration} detailed />
            <dl className="grid gap-x-8 gap-y-3 border-t border-line px-4 py-4 text-sm sm:grid-cols-[220px_1fr]">
              <dt className="text-muted">Job source</dt>
              <dd>
                {snapshot.data.providers.jobSource}
                {snapshot.data.providers.jobSourceIsMock && " (mock)"}
              </dd>
              <dt className="text-muted">AI model</dt>
              <dd>
                {snapshot.data.providers.ai}: {snapshot.data.providers.aiModel}
                {snapshot.data.providers.aiIsMock && " (mock)"}
              </dd>
              <dt className="text-muted">WhatsApp</dt>
              <dd>
                {snapshot.data.providers.whatsapp}
                {snapshot.data.providers.whatsappIsMock && " (mock)"}
              </dd>
              <dt className="text-muted">Prompt and rubric</dt>
              <dd>
                Prompt {snapshot.data.promptVersion}, rubric {snapshot.data.rubricVersion}
              </dd>
              <dt className="text-muted">Executor</dt>
              <dd>{snapshot.data.executor === "n8n" ? "n8n workflow" : "In-process"}</dd>
            </dl>
          </>
        ) : (
          <p className="px-4 py-4 text-sm text-warning">
            This run&apos;s stored settings use a format this version cannot read. The raw record is below.
          </p>
        )}
        <details className="border-t border-line px-4 py-3 text-[13px]">
          <summary className="cursor-pointer text-muted hover:text-ink">Show raw configuration</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-control bg-sunken p-3 text-xs">
            {JSON.stringify(run.configurationSnapshot, null, 2)}
          </pre>
        </details>
      </Panel>
    </div>
  );
}
