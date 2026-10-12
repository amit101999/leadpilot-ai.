"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/ui/copy-button";
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
import { isSafeLinkHref } from "@/lib/security/url";
import { formatMoney } from "@/lib/ui/format";

export interface LeadRow {
  id: string;
  title: string;
  jobUrl: string | null;
  budgetType: string;
  budgetAmount: string | null;
  budgetMax: string | null;
  currency: string | null;
  paymentVerified: boolean | null;
  skillMatches: string[];
  firstSeenAt: Date | string | null;
  evaluatedAt: Date | string | null;
  runId: string;
  profileName: string;
  score: number | null;
  decision: string;
  notificationStatus: string | null;
}

const PAYMENT: Record<string, { tone: "success" | "danger" | "neutral"; label: string }> = {
  true: { tone: "success", label: "Verified" },
  false: { tone: "danger", label: "Not verified" },
  null: { tone: "neutral", label: "Unknown" },
};

const columns: ColumnDef<LeadRow, unknown>[] = [
  {
    id: "title",
    header: "Job",
    cell: ({ row }) => {
      const lead = row.original;
      return (
        <div className="min-w-56 max-w-md">
          <div className="flex items-start gap-1.5">
            <Link
              href={`/jobs/${lead.id}`}
              className="font-medium text-ink hover:text-accent hover:underline"
            >
              {lead.title}
            </Link>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-muted">
            <span className="truncate">{lead.profileName}</span>
            {isSafeLinkHref(lead.jobUrl) && (
              <>
                <a
                  href={lead.jobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-ink"
                  aria-label={`Open job posting: ${lead.title}`}
                >
                  <ExternalLink className="size-3.5" />
                  Open
                </a>
                <CopyButton value={lead.jobUrl} label="Copy job link" />
              </>
            )}
          </div>
        </div>
      );
    },
  },
  {
    id: "budget",
    header: "Budget",
    meta: { sortKey: "budget", align: "right" },
    cell: ({ row }) => (
      <div className="tabular whitespace-nowrap">
        {formatMoney(row.original.budgetAmount, row.original.currency)}
        <div className="text-muted">
          {row.original.budgetType === "FIXED"
            ? "Fixed"
            : row.original.budgetType === "HOURLY"
              ? "Hourly"
              : "Unknown"}
        </div>
      </div>
    ),
  },
  {
    id: "skills",
    header: "Skills matched",
    cell: ({ row }) => (
      <div className="flex max-w-56 flex-wrap gap-1">
        {row.original.skillMatches.length ? (
          row.original.skillMatches.slice(0, 4).map((s) => <Badge key={s}>{s}</Badge>)
        ) : (
          <span className="text-muted">–</span>
        )}
      </div>
    ),
  },
  {
    id: "payment",
    header: "Payment",
    cell: ({ row }) => {
      const p = PAYMENT[String(row.original.paymentVerified)] ?? PAYMENT.null!;
      return <Badge tone={p.tone}>{p.label}</Badge>;
    },
  },
  {
    id: "score",
    header: "AI score",
    meta: { sortKey: "score", align: "right" },
    cell: ({ row }) => (
      <span className="tabular font-semibold">
        {row.original.score ?? "–"}
        <span className="font-normal text-muted">/100</span>
      </span>
    ),
  },
  {
    id: "decision",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.decision} />,
  },
  {
    id: "found",
    header: "Found",
    meta: { sortKey: "firstSeen" },
    cell: ({ row }) => (
      <div className="whitespace-nowrap">
        <Time value={row.original.firstSeenAt} />
        <div className="text-muted">
          Checked <Time value={row.original.evaluatedAt} />
        </div>
      </div>
    ),
  },
  {
    id: "alert",
    header: "Alert",
    cell: ({ row }) =>
      row.original.notificationStatus ? (
        <StatusBadge status={row.original.notificationStatus} />
      ) : (
        <span className="text-muted">Not sent</span>
      ),
  },
];

const DECISIONS = ["NEEDS_REVIEW", "REJECTED", "AI_ERROR"];
const ALERT_STATUSES = [
  "NONE",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED_PERMANENT",
  "FAILED_RETRYABLE",
  "UNCERTAIN",
];

export function LeadsTable({
  rows,
  meta,
  profiles,
  exportUrl,
}: {
  rows: LeadRow[];
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
          "decision",
          "budgetMin",
          "budgetMax",
          "scoreMin",
          "scoreMax",
          "skill",
          "paymentVerified",
          "discoveredFrom",
          "discoveredTo",
          "notificationStatus",
        ]}
      >
        <SearchFilter param="search" label="Search" placeholder="Job title or source ID" />
        <SelectFilter param="profileId" label="Profile" options={profiles} allLabel="All profiles" />
        <SelectFilter
          param="decision"
          label="Status"
          allLabel="Qualified"
          options={[
            ...DECISIONS.map((d) => ({ value: d, label: statusLabel(d) })),
            { value: "any", label: "Any status" },
          ]}
        />
        <SearchFilter param="skill" label="Skill" placeholder="e.g. React" />
        <NumberFilter param="budgetMin" label="Min. budget" min={0} max={10_000_000} />
        <NumberFilter param="budgetMax" label="Max. budget" min={0} max={10_000_000} />
        <NumberFilter param="scoreMin" label="Min. score" min={0} max={100} />
        <NumberFilter param="scoreMax" label="Max. score" min={0} max={100} />
        <SelectFilter
          param="paymentVerified"
          label="Payment"
          allLabel="Any"
          options={[
            { value: "true", label: "Verified" },
            { value: "false", label: "Not verified" },
            { value: "unknown", label: "Unknown" },
          ]}
        />
        <SelectFilter
          param="notificationStatus"
          label="Alert"
          allLabel="Any"
          options={ALERT_STATUSES.map((s) => ({
            value: s,
            label: s === "NONE" ? "Not sent" : statusLabel(s),
          }))}
        />
        <DateFilter param="discoveredFrom" label="Found from" />
        <DateFilter param="discoveredTo" label="Found to" />
        <div className="ml-auto self-end">
          <ExportLink href={exportUrl} />
        </div>
      </FilterBar>
      <DataTable
        columns={columns}
        data={rows}
        meta={meta}
        caption="Qualified leads"
        defaultSort={{ key: "score", dir: "desc" }}
        empty={
          <EmptyState title="No leads match these filters">
            Leads appear after a run finds jobs that pass every rule and reach the minimum AI score.
          </EmptyState>
        }
      />
    </>
  );
}
