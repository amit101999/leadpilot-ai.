import type { Metadata } from "next";
import { LeadsTable } from "@/components/leads/leads-table";
import { Panel } from "@/components/ui/panel";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/database/client";
import { exportHref } from "@/lib/ui/export-href";
import { resolvePagination } from "@/lib/validation/common";
import { parseSearchParams, type RawSearchParams } from "@/lib/validation/search-params";
import { leadListQuery } from "@/modules/jobs/list-query";
import { listLeads } from "@/modules/jobs/queries";
import { listProfiles } from "@/modules/profiles/service";

export const metadata: Metadata = { title: "Qualified Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { actor } = await requireUser();
  const db = getDb();
  const raw = await searchParams;
  // No status filter means "qualified" (the page's purpose); "any" lifts the filter.
  const anyDecision = raw.decision === "any";
  const query = parseSearchParams(leadListQuery, anyDecision ? { ...raw, decision: undefined } : raw);
  const filters = {
    ...query,
    decision: anyDecision
      ? undefined
      : query.decision?.length
        ? query.decision
        : (["QUALIFIED"] as const).slice(),
  };
  const page = resolvePagination(query);
  const [{ items, total }, profiles] = await Promise.all([
    listLeads(db, actor, { ...filters, ...page }),
    listProfiles(db, actor, { includeArchived: true }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[28px] leading-tight font-semibold">Qualified Leads</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Jobs that passed every rule and reached the profile&apos;s minimum AI score. Open a job to see the
          full assessment and why it qualified.
        </p>
      </header>
      <Panel id="leads">
        <LeadsTable
          rows={items}
          meta={{
            page: page.page,
            pageSize: page.pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / page.pageSize)),
          }}
          profiles={profiles.map((p) => ({
            value: p.id,
            label: p.archivedAt ? `${p.name} (archived)` : p.name,
          }))}
          exportUrl={exportHref("/api/exports/leads.csv", filters)}
        />
      </Panel>
    </div>
  );
}
