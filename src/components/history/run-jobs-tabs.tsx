"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/panel";
import { isSafeLinkHref } from "@/lib/security/url";
import { cn } from "@/lib/ui/cn";
import { formatMoney } from "@/lib/ui/format";
import { useUrlState } from "@/lib/ui/use-url-state";

export interface RunJob {
  id: string;
  title: string;
  jobUrl: string | null;
  budgetType: string;
  budgetAmount: string | null;
  currency: string | null;
  processingStatus: string;
  score: number | null;
  decision: string | null;
  rank: number | null;
  previouslySeen: boolean;
  rejectionReasons: string[];
  decisionReasons: string[] | null;
  aiError: string | null;
  notificationNote: string | null;
  reasoningSummary: string | null;
  hardCheckResults: Array<{ rule: string; outcome: string; message: string }>;
}

const TABS = [
  { key: "qualified", label: "Qualified", statuses: ["QUALIFIED"] },
  { key: "rejected", label: "Rejected", statuses: ["FILTERED_OUT", "REJECTED"] },
  {
    key: "uncertain",
    label: "Uncertain",
    statuses: ["NEEDS_REVIEW", "AI_ERROR", "PENDING_AI", "NEW", "SOURCE_ERROR"],
  },
  { key: "all", label: "All", statuses: null },
] as const;

/** Reasons the system recorded for this job, most specific first, without duplicates. */
function reasonsFor(job: RunJob): string[] {
  const reasons = [
    ...(job.decisionReasons ?? []),
    ...job.rejectionReasons,
    ...(job.aiError ? [`AI error: ${job.aiError}`] : []),
  ];
  return [...new Set(reasons)];
}

export function RunJobsTabs({ jobs }: { jobs: RunJob[] }) {
  const url = useUrlState();
  const active = TABS.find((t) => t.key === url.get("tab")) ?? TABS[0];
  const visible = active.statuses
    ? jobs.filter((j) => (active.statuses as readonly string[]).includes(j.processingStatus))
    : jobs;

  return (
    <div>
      {/* Toggle buttons (aria-pressed) rather than ARIA tabs, which would also require arrow-key navigation. */}
      <div
        role="group"
        aria-label="Show jobs by outcome"
        className="flex gap-1 overflow-x-auto border-b border-line px-2"
      >
        {TABS.map((tab) => {
          const n = tab.statuses
            ? jobs.filter((j) => (tab.statuses as readonly string[]).includes(j.processingStatus)).length
            : jobs.length;
          const selected = tab.key === active.key;
          return (
            <button
              key={tab.key}
              type="button"
              aria-pressed={selected}
              aria-controls="run-jobs-panel"
              onClick={() => url.update({ tab: tab.key === "qualified" ? null : tab.key })}
              className={cn(
                "-mb-px border-b-2 px-3 py-2.5 text-sm whitespace-nowrap",
                selected
                  ? "border-accent font-medium text-ink"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              {tab.label} <span className="tabular text-muted">{n}</span>
            </button>
          );
        })}
      </div>

      <div id="run-jobs-panel" role="region" aria-label={`${active.label} jobs`}>
        {visible.length === 0 ? (
          <EmptyState title={`No ${active.label.toLowerCase()} jobs in this run`} />
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((job) => {
              const failed = job.hardCheckResults.filter(
                (c) => c.outcome === "FAIL" || c.outcome === "UNKNOWN",
              );
              const reasons = reasonsFor(job);
              return (
                <li
                  key={job.id}
                  className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <Link
                        href={`/jobs/${job.id}`}
                        className="font-medium text-ink hover:text-accent hover:underline"
                      >
                        {job.title}
                      </Link>
                      {isSafeLinkHref(job.jobUrl) && (
                        <a
                          href={job.jobUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open job posting: ${job.title}`}
                          className="mt-0.5 text-muted hover:text-ink"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                    </div>
                    <p className="tabular text-[13px] text-muted">
                      {formatMoney(job.budgetAmount, job.currency)}
                      {job.budgetType === "HOURLY" ? " per hour" : job.budgetType === "FIXED" ? " fixed" : ""}
                      {job.previouslySeen && ", seen in an earlier run"}
                      {job.rank !== null && `, rank ${job.rank}`}
                    </p>
                    {job.reasoningSummary && <p className="mt-1 text-[13px]">{job.reasoningSummary}</p>}
                    {reasons.length > 0 && (
                      <ul className="mt-1 list-disc pl-5 text-[13px] text-muted">
                        {reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    )}
                    {failed.length > 0 && reasons.length === 0 && (
                      <p className="mt-1 text-[13px] text-muted">
                        {failed.map((c) => `${c.message} (${c.outcome.toLowerCase()})`).join("; ")}
                      </p>
                    )}
                    {job.notificationNote && (
                      <p className="mt-1 text-[13px] text-muted">Alert: {job.notificationNote}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {job.score !== null && (
                      <span className="tabular text-sm font-semibold" title="AI match score">
                        {job.score}
                        <span className="text-[13px] font-normal text-muted">/100</span>
                      </span>
                    )}
                    <StatusBadge status={job.processingStatus} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
