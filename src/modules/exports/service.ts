import type { Actor } from "@/lib/auth/authorization";
import type { Database } from "@/lib/database/client";
import { toCsv } from "@/lib/security/csv";
import { listLeads, type LeadListFilters } from "@/modules/jobs/queries";
import { listRuns, type RunListFilters } from "@/modules/runs/service";

/** Exports use the same filters as the on-screen tables and stop at this many rows. */
export const EXPORT_ROW_LIMIT = 10_000;

export interface CsvExport {
  csv: string;
  rows: number;
  truncated: boolean;
}

/** Fetches one row more than the limit to detect truncation without a separate count. */
function limitRows<T>(items: T[]): { rows: T[]; truncated: boolean } {
  return { rows: items.slice(0, EXPORT_ROW_LIMIT), truncated: items.length > EXPORT_ROW_LIMIT };
}

const yesNoUnknown = (value: boolean | null) => (value === null ? "unknown" : value ? "yes" : "no");

export async function exportLeadsCsv(
  db: Database,
  actor: Actor,
  filters: Omit<LeadListFilters, "offset" | "pageSize">,
): Promise<CsvExport> {
  const { items } = await listLeads(db, actor, { ...filters, offset: 0, pageSize: EXPORT_ROW_LIMIT + 1 });
  const { rows, truncated } = limitRows(items);
  const csv = toCsv(rows, [
    { header: "Job title", value: (r) => r.title },
    { header: "Budget", value: (r) => r.budgetAmount },
    { header: "Budget max", value: (r) => r.budgetMax },
    { header: "Currency", value: (r) => r.currency },
    { header: "Job type", value: (r) => r.budgetType },
    { header: "Skills matched", value: (r) => r.skillMatches.join("; ") },
    { header: "Payment verified", value: (r) => yesNoUnknown(r.paymentVerified) },
    { header: "AI score", value: (r) => r.score },
    { header: "Decision", value: (r) => r.decision },
    { header: "First discovered", value: (r) => r.firstSeenAt },
    { header: "Evaluated", value: (r) => r.evaluatedAt },
    { header: "Notification status", value: (r) => r.notificationStatus ?? "NONE" },
    { header: "Profile", value: (r) => r.profileName },
    { header: "Run ID", value: (r) => r.runId },
    { header: "Source", value: (r) => r.source },
    { header: "Source job ID", value: (r) => r.sourceJobId },
    { header: "Job URL", value: (r) => r.jobUrl },
  ]);
  return { csv, rows: rows.length, truncated };
}

export async function exportRunsCsv(
  db: Database,
  actor: Actor,
  filters: Omit<RunListFilters, "offset" | "pageSize" | "page">,
): Promise<CsvExport> {
  const { items } = await listRuns(db, actor, {
    ...filters,
    page: 1,
    offset: 0,
    pageSize: EXPORT_ROW_LIMIT + 1,
  });
  const { rows, truncated } = limitRows(items);
  const csv = toCsv(rows, [
    { header: "Run ID", value: (r) => r.id },
    { header: "Created", value: (r) => r.createdAt },
    { header: "Profile", value: (r) => r.profileName },
    { header: "Configuration version", value: (r) => r.versionNumber },
    { header: "Status", value: (r) => r.status },
    { header: "Jobs discovered", value: (r) => r.sourceCount },
    { header: "Passed hard filters", value: (r) => r.hardFilterPassCount },
    { header: "AI evaluated", value: (r) => r.aiEvaluatedCount },
    { header: "Qualified", value: (r) => r.qualifiedCount },
    { header: "Rejected", value: (r) => r.rejectedCount },
    { header: "Notifications sent", value: (r) => r.notifiedCount },
    { header: "Notification failures", value: (r) => r.failedNotificationCount },
    {
      header: "Duration (s)",
      value: (r) => (r.durationMs === null ? null : Math.round(r.durationMs / 1000)),
    },
    { header: "Source", value: (r) => r.sourceProvider },
  ]);
  return { csv, rows: rows.length, truncated };
}
