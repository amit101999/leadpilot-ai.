"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { DataTable, type PageMeta } from "@/components/table/data-table";
import { FilterBar, SearchFilter, SelectFilter } from "@/components/table/filters";
import { Badge, StatusBadge, statusLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/panel";
import { Time } from "@/components/ui/time";
import { formatMoney } from "@/lib/ui/format";

export interface JobRow {
  id: string;
  source: string;
  sourceJobId: string;
  title: string;
  budgetType: string;
  budgetAmount: string | null;
  hourlyMin: string | null;
  currency: string | null;
  firstSeenAt: Date | string | null;
  lastCheckedAt: Date | string | null;
  processingStatus: string;
  rejectionReasons: string[];
  previouslySeen: boolean;
  score: number | null;
  notified: boolean;
}

const STATUSES = [
  "QUALIFIED",
  "FILTERED_OUT",
  "REJECTED",
  "NEEDS_REVIEW",
  "AI_ERROR",
  "PENDING_AI",
  "NEW",
  "SOURCE_ERROR",
];

const columns: ColumnDef<JobRow, unknown>[] = [
  {
    id: "title",
    header: "Job",
    meta: { sortKey: "title" },
    cell: ({ row }) => (
      <div className="min-w-56 max-w-md">
        <Link
          href={`/jobs/${row.original.id}`}
          className="font-medium text-ink hover:text-accent hover:underline"
        >
          {row.original.title}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 text-muted">
          <span>
            {row.original.source}, {row.original.sourceJobId}
          </span>
          {row.original.source === "mock" && <Badge tone="warning">Mock source</Badge>}
        </div>
      </div>
    ),
  },
  {
    id: "budget",
    header: "Budget",
    meta: { sortKey: "budget", align: "right" },
    cell: ({ row }) => {
      const job = row.original;
      return (
        <div className="tabular whitespace-nowrap">
          {job.budgetType === "HOURLY"
            ? `${formatMoney(job.hourlyMin, job.currency)}/h`
            : formatMoney(job.budgetAmount, job.currency)}
          <div className="text-muted">
            {job.budgetType === "FIXED" ? "Fixed" : job.budgetType === "HOURLY" ? "Hourly" : "Unknown"}
          </div>
        </div>
      );
    },
  },
  {
    id: "status",
    header: "Latest outcome",
    cell: ({ row }) => (
      <div className="max-w-72">
        <StatusBadge status={row.original.processingStatus} />
        {row.original.rejectionReasons.length > 0 && (
          <p className="mt-1 text-muted">
            {row.original.rejectionReasons.slice(0, 2).join("; ")}
            {row.original.rejectionReasons.length > 2 &&
              ` and ${row.original.rejectionReasons.length - 2} more`}
          </p>
        )}
      </div>
    ),
  },
  {
    id: "score",
    header: "AI score",
    meta: { sortKey: "score", align: "right" },
    cell: ({ row }) =>
      row.original.score === null ? (
        <span className="text-muted" title="Not evaluated by AI">
          –
        </span>
      ) : (
        <span className="tabular font-semibold">{row.original.score}</span>
      ),
  },
  {
    id: "flags",
    header: "History",
    cell: ({ row }) => (
      <div className="flex flex-col items-start gap-1">
        {row.original.notified && <Badge tone="success">Alert sent</Badge>}
        {row.original.previouslySeen && <Badge>Seen before</Badge>}
        {!row.original.notified && !row.original.previouslySeen && <span className="text-muted">New</span>}
      </div>
    ),
  },
  {
    id: "seen",
    header: "Found",
    meta: { sortKey: "firstSeen" },
    cell: ({ row }) => (
      <div className="whitespace-nowrap">
        <Time value={row.original.firstSeenAt} />
        <div className="text-muted">
          Checked <Time value={row.original.lastCheckedAt} />
        </div>
      </div>
    ),
  },
];

export function JobsTable({
  rows,
  meta,
  profiles,
}: {
  rows: JobRow[];
  meta: PageMeta;
  profiles: Array<{ value: string; label: string }>;
}) {
  return (
    <>
      <FilterBar filterKeys={["search", "profileId", "status", "previouslySeen", "notified", "source"]}>
        <SearchFilter param="search" label="Search" placeholder="Job title or source ID" />
        <SelectFilter param="profileId" label="Profile" options={profiles} allLabel="All profiles" />
        <SelectFilter
          param="status"
          label="Latest outcome"
          options={STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
          allLabel="Any outcome"
        />
        <SelectFilter
          param="previouslySeen"
          label="Seen before"
          allLabel="Any"
          options={[
            { value: "true", label: "Seen in an earlier run" },
            { value: "false", label: "First seen in its latest run" },
          ]}
        />
        <SelectFilter
          param="notified"
          label="Alert"
          allLabel="Any"
          options={[
            { value: "true", label: "Alert sent" },
            { value: "false", label: "No alert sent" },
          ]}
        />
      </FilterBar>
      <DataTable
        columns={columns}
        data={rows}
        meta={meta}
        caption="All discovered jobs"
        defaultSort={{ key: "firstSeen", dir: "desc" }}
        empty={
          <EmptyState title="No jobs match these filters">
            Jobs appear here after a run, including the ones that did not qualify.
          </EmptyState>
        }
      />
    </>
  );
}
