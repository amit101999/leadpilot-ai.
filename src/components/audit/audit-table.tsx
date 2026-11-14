"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, type PageMeta } from "@/components/table/data-table";
import { DateFilter, FilterBar, SelectFilter } from "@/components/table/filters";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/panel";
import { Time } from "@/components/ui/time";
import { diffJson } from "@/lib/ui/json-diff";

export interface AuditRow {
  id: string;
  createdAt: Date | string;
  actorType: string;
  userEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeState: unknown;
  afterState: unknown;
  requestId: string | null;
}

/** Every action the application records (see recordAudit calls). */
export const AUDIT_ACTIONS = [
  "auth.login",
  "auth.password_change",
  "profile.create",
  "profile.update",
  "profile.archive",
  "profile.restore",
  "profile.set_default",
  "recipient.create",
  "recipient.update",
  "run.create",
  "run.cancel",
  "run.resume",
  "run.finish",
  "run.fail",
  "notification.retry",
  "notification.reconciled",
  "notification.failed",
  "email.test_message",
];

const ENTITY_TYPES = [
  { value: "search_profile", label: "Search profile" },
  { value: "agent_run", label: "Run" },
  { value: "notification", label: "Notification" },
  { value: "notification_recipient", label: "Recipient" },
  { value: "user", label: "User" },
];

const ACTOR_LABEL: Record<string, string> = {
  SYSTEM: "System",
  EXECUTOR: "Run executor",
  // Older entries only: WhatsApp delivery updates, removed together with WhatsApp alerts.
  WEBHOOK: "WhatsApp webhook",
};

function Changes({ before, after }: { before: unknown; after: unknown }) {
  const changes = diffJson(before, after);
  if (changes.length === 0) return <span className="text-muted">No recorded details</span>;
  // Entries with only an "after" state (e.g. run.finish) record values rather than changes.
  const recordedOnly = before === null || before === undefined;
  const noun = recordedOnly
    ? `${changes.length} recorded ${changes.length === 1 ? "value" : "values"}`
    : `${changes.length} ${changes.length === 1 ? "change" : "changes"}`;
  return (
    <details>
      <summary className="cursor-pointer text-muted hover:text-ink">{noun}</summary>
      <ul className="mt-1 flex max-w-xl flex-col gap-0.5">
        {changes.map((c) => (
          <li key={c.path} className="break-words">
            <code className="text-xs">{c.path}</code>
            {recordedOnly ? (
              <>
                {" = "}
                <span>{c.after}</span>
              </>
            ) : (
              <>
                : <span className="text-muted">{c.before}</span>
                <span aria-hidden> → </span>
                <span className="sr-only"> changed to </span>
                <span>{c.after}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

const columns: ColumnDef<AuditRow, unknown>[] = [
  {
    id: "when",
    header: "When",
    cell: ({ row }) => (
      <span className="whitespace-nowrap">
        <Time value={row.original.createdAt} />
      </span>
    ),
  },
  {
    id: "who",
    header: "Who",
    cell: ({ row }) =>
      row.original.userEmail ?? (
        <span className="text-muted">{ACTOR_LABEL[row.original.actorType] ?? row.original.actorType}</span>
      ),
  },
  {
    id: "action",
    header: "Action",
    cell: ({ row }) => <Badge>{row.original.action}</Badge>,
  },
  {
    id: "entity",
    header: "Record",
    cell: ({ row }) => (
      <div>
        {ENTITY_TYPES.find((e) => e.value === row.original.entityType)?.label ?? row.original.entityType}
        {row.original.entityId && (
          <div className="text-muted" title={row.original.entityId}>
            {row.original.entityId.slice(0, 8)}
          </div>
        )}
      </div>
    ),
  },
  {
    id: "changes",
    header: "Details",
    cell: ({ row }) => <Changes before={row.original.beforeState} after={row.original.afterState} />,
  },
];

export function AuditTable({
  rows,
  meta,
  users,
}: {
  rows: AuditRow[];
  meta: PageMeta;
  users: Array<{ value: string; label: string }>;
}) {
  return (
    <>
      <FilterBar filterKeys={["action", "entityType", "userId", "from", "to"]}>
        <SelectFilter
          param="action"
          label="Action"
          options={AUDIT_ACTIONS.map((a) => ({ value: a, label: a }))}
          allLabel="Any action"
        />
        <SelectFilter param="entityType" label="Record type" options={ENTITY_TYPES} allLabel="Any record" />
        <SelectFilter param="userId" label="User" options={users} allLabel="Anyone" />
        <DateFilter param="from" label="From" />
        <DateFilter param="to" label="To" />
      </FilterBar>
      <DataTable
        columns={columns}
        data={rows}
        meta={meta}
        caption="Audit log"
        defaultSort={{ key: "createdAt", dir: "desc" }}
        empty={<EmptyState title="No audit entries match these filters" />}
      />
    </>
  );
}
