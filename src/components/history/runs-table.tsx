"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { DataTable, type PageMeta } from "@/components/table/data-table";
import {
  DateFilter,
  ExportLink,
  FilterBar,
  NumberFilter,
  SearchFilter,
  SelectFilter,
} from "@/components/table/filters";
import { Badge, StatusBadge, statusLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/panel";
import { Time } from "@/components/ui/time";
import { formatCount, formatDuration, shortId } from "@/lib/ui/format";

export interface RunRow {
  id: string;
  createdAt: Date | string;
  profileName: string;
  versionNumber: number;
  status: string;
  sourceProvider: string;
  sourceCount: number;
  hardFilterPassCount: number;
  qualifiedCount: number;
  rejectedCount: number;
  notifiedCount: number;
  failedNotificationCount: number;
  durationMs: number | null;
}

const RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "COMPLETED_WITH_ERRORS",
  "FAILED",
  "CANCELLED",
  "BLOCKED_SOURCE",
];

const count = (value: number) => <span className="tabular">{formatCount(value)}</span>;

const columns: ColumnDef<RunRow, unknown>[] = [
  {
    id: "run",
    header: "Run",
    meta: { sortKey: "createdAt" },
    cell: ({ row }) => (
      <div className="whitespace-nowrap">
        <Link href={`/history/${row.original.id}`} className="font-medium text-accent hover:underline">
          {shortId(row.original.id)}
        </Link>
        <div className="text-muted">
          <Time value={row.original.createdAt} />
        </div>
      </div>
    ),
  },
  {
    id: "profile",
    header: "Profile",
    cell: ({ row }) => (
      <div className="max-w-56">
        <div className="truncate" title={row.original.profileName}>
          {row.original.profileName}
        </div>
        <div className="text-muted">Version {row.original.versionNumber}</div>
      </div>
    ),
  },
  {
    id: "status",
    header: "Status",
    meta: { sortKey: "status" },
    cell: ({ row }) => (
      <div className="flex flex-col items-start gap-1">
        <StatusBadge status={row.original.status} />
        {row.original.sourceProvider === "mock" && <Badge tone="warning">Mock source</Badge>}
      </div>
    ),
  },
  {
    id: "discovered",
    header: "Discovered",
    meta: { sortKey: "discovered", align: "right" },
    cell: ({ row }) => count(row.original.sourceCount),
  },
  {
    id: "passed",
    header: "Passed rules",
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.hardFilterPassCount),
  },
  {
    id: "qualified",
    header: "Qualified",
    meta: { sortKey: "qualified", align: "right" },
    cell: ({ row }) => count(row.original.qualifiedCount),
  },
  {
    id: "rejected",
    header: "Rejected",
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.rejectedCount),
  },
  {
    id: "notified",
    header: "Alerts sent",
    meta: { sortKey: "notified", align: "right" },
    cell: ({ row }) => (
      <span className="tabular">
        {formatCount(row.original.notifiedCount)}
        {row.original.failedNotificationCount > 0 && (
          <span className="block text-danger">{row.original.failedNotificationCount} failed</span>
        )}
      </span>
    ),
  },
  {
    id: "duration",
    header: "Duration",
    meta: { align: "right" },
    cell: ({ row }) => <span className="tabular">{formatDuration(row.original.durationMs)}</span>,
  },
];

export function RunsTable({
  rows,
  meta,
  profiles,
  exportUrl,
}: {
  rows: RunRow[];
  meta: PageMeta;
  profiles: Array<{ value: string; label: string }>;
  exportUrl: string;
}) {
  return (
    <>
      <FilterBar
        filterKeys={[
          "search",
          "profileId",
          "status",
          "from",
          "to",
          "minQualified",
          "failedOnly",
          "notificationFailures",
        ]}
      >
        <SearchFilter param="search" label="Search" placeholder="Run ID or profile" />
        <SelectFilter param="profileId" label="Profile" options={profiles} allLabel="All profiles" />
        <SelectFilter
          param="status"
          label="Status"
          options={RUN_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
          allLabel="Any status"
        />
        <DateFilter param="from" label="From" />
        <DateFilter param="to" label="To" />
        <NumberFilter param="minQualified" label="Min. qualified" min={0} max={100000} />
        <SelectFilter
          param="failedOnly"
          label="Problems"
          options={[{ value: "true", label: "Failed, blocked or with errors" }]}
          allLabel="All runs"
        />
        <SelectFilter
          param="notificationFailures"
          label="Alerts"
          options={[{ value: "true", label: "Runs with failed alerts" }]}
          allLabel="All runs"
        />
        <div className="ml-auto self-end">
          <ExportLink href={exportUrl} />
        </div>
      </FilterBar>
      <DataTable
        columns={columns}
        data={rows}
        meta={meta}
        caption="Runs"
        defaultSort={{ key: "createdAt", dir: "desc" }}
        empty={
          <EmptyState title="No runs match these filters">
            Clear the filters, or start a run from the Run Agent page.
          </EmptyState>
        }
      />
    </>
  );
}
