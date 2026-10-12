"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { DataTable, type PageMeta } from "@/components/table/data-table";
import { FilterBar, SearchFilter, SelectFilter } from "@/components/table/filters";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/panel";
import { Time } from "@/components/ui/time";
import { RetryButton } from "./retry-button";

export interface NotificationRow {
  id: string;
  jobId: string;
  jobTitle: string;
  runId: string;
  recipientLabel: string;
  channel: string;
  status: string;
  providerMessageId: string | null;
  attempts: number;
  messagePreview: string;
  lastAttemptAt: Date | string | null;
  sentAt: Date | string | null;
  deliveredAt: Date | string | null;
  readAt: Date | string | null;
  lastError: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/** Status groups offered in the filter (the URL carries the underlying statuses). */
const STATUS_GROUPS = [
  { value: "FAILED_PERMANENT,FAILED_RETRYABLE", label: "Failed" },
  { value: "UNCERTAIN", label: "Delivery unknown" },
  { value: "RESERVED", label: "Pending" },
  { value: "SENDING", label: "Sending" },
  { value: "SENT,DELIVERED,READ", label: "Sent" },
  { value: "CANCELLED", label: "Cancelled" },
];

function columns(canOperate: boolean): ColumnDef<NotificationRow, unknown>[] {
  const cols: ColumnDef<NotificationRow, unknown>[] = [
    {
      id: "job",
      header: "Job",
      cell: ({ row }) => (
        <div className="min-w-56 max-w-sm">
          <Link
            href={`/jobs/${row.original.jobId}`}
            className="font-medium text-ink hover:text-accent hover:underline"
          >
            {row.original.jobTitle}
          </Link>
          <details className="mt-1">
            <summary className="cursor-pointer text-muted hover:text-ink">Message preview</summary>
            <p className="mt-1 whitespace-pre-wrap">{row.original.messagePreview}</p>
          </details>
        </div>
      ),
    },
    {
      id: "recipient",
      header: "Recipient",
      cell: ({ row }) => (
        <div>
          {row.original.recipientLabel}
          <div className="text-muted">WhatsApp</div>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={row.original.status} />
          <span className="text-muted">
            {row.original.attempts} {row.original.attempts === 1 ? "attempt" : "attempts"}
          </span>
        </div>
      ),
    },
    {
      id: "times",
      header: "Timeline",
      cell: ({ row }) => {
        const n = row.original;
        return (
          <div className="whitespace-nowrap text-muted">
            <div>
              Reserved <Time value={n.createdAt} />
            </div>
            {n.sentAt && (
              <div>
                Sent <Time value={n.sentAt} />
              </div>
            )}
            {n.deliveredAt && (
              <div>
                Delivered <Time value={n.deliveredAt} />
              </div>
            )}
            {n.readAt && (
              <div>
                Read <Time value={n.readAt} />
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: "error",
      header: "Last error",
      cell: ({ row }) => (
        <div className="max-w-64">
          {row.original.lastError ? (
            <span className="text-danger">{row.original.lastError}</span>
          ) : (
            <span className="text-muted">–</span>
          )}
          {row.original.providerMessageId && (
            <div className="truncate text-muted" title={row.original.providerMessageId}>
              Message ID {row.original.providerMessageId}
            </div>
          )}
        </div>
      ),
    },
  ];
  if (canOperate) {
    cols.push({
      id: "action",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => <RetryButton notification={row.original} />,
    });
  }
  return cols;
}

export function NotificationsTable({
  rows,
  meta,
  canOperate,
}: {
  rows: NotificationRow[];
  meta: PageMeta;
  canOperate: boolean;
}) {
  return (
    <>
      <FilterBar filterKeys={["search", "status"]}>
        <SearchFilter param="search" label="Search" placeholder="Job title" />
        <SelectFilter param="status" label="Status" options={STATUS_GROUPS} allLabel="Any status" />
      </FilterBar>
      <DataTable
        columns={columns(canOperate)}
        data={rows}
        meta={meta}
        caption="WhatsApp alerts"
        defaultSort={{ key: "createdAt", dir: "desc" }}
        empty={
          <EmptyState title="No alerts match these filters">
            Alerts appear when a run qualifies leads for a profile with WhatsApp turned on.
          </EmptyState>
        }
      />
    </>
  );
}
