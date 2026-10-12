import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AuditTable } from "@/components/audit/audit-table";
import { Panel } from "@/components/ui/panel";
import { hasRole } from "@/lib/auth/authorization";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/database/client";
import { paginationQuery, q, resolvePagination } from "@/lib/validation/common";
import { parseSearchParams, type RawSearchParams } from "@/lib/validation/search-params";
import { listAuditLogs } from "@/modules/audit/service";
import { listUsers } from "@/modules/users/service";

export const metadata: Metadata = { title: "Audit Logs" };

const query = z.object({
  ...paginationQuery,
  action: q.string(100),
  entityType: q.string(100),
  userId: q.uuid(),
  from: q.date(),
  to: q.endDate(),
});

export default async function AuditPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { actor } = await requireUser();
  // Admin only; other roles get a plain not-found page rather than a hint that the page exists.
  if (!hasRole(actor, "ADMIN")) notFound();
  const db = getDb();
  const filters = parseSearchParams(query, await searchParams);
  const page = resolvePagination(filters);
  const [{ items, total }, users] = await Promise.all([
    listAuditLogs(db, actor, { ...filters, ...page }),
    listUsers(db, actor),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[28px] leading-tight font-semibold">Audit Logs</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Who changed what and when: sign-ins, profile versions, recipients, runs and alert retries. Entries
          cannot be edited.
        </p>
      </header>
      <Panel id="audit">
        <AuditTable
          rows={items}
          meta={{
            page: page.page,
            pageSize: page.pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / page.pageSize)),
          }}
          users={users.map((u) => ({ value: u.id, label: u.email }))}
        />
      </Panel>
    </div>
  );
}
