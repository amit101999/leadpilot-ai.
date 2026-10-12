import type { Metadata } from "next";
import { JobsTable } from "@/components/jobs/jobs-table";
import { Panel } from "@/components/ui/panel";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/database/client";
import { resolvePagination } from "@/lib/validation/common";
import { parseSearchParams, type RawSearchParams } from "@/lib/validation/search-params";
import { jobListQuery } from "@/modules/jobs/list-query";
import { listJobs } from "@/modules/jobs/queries";
import { listProfiles } from "@/modules/profiles/service";

export const metadata: Metadata = { title: "All Jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { actor } = await requireUser();
  const db = getDb();
  const query = parseSearchParams(jobListQuery, await searchParams);
  const page = resolvePagination(query);
  const [{ items, total }, profiles] = await Promise.all([
    listJobs(db, actor, { ...query, ...page }),
    listProfiles(db, actor, { includeArchived: true }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[28px] leading-tight font-semibold">All Jobs</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Every job the agent has discovered, including the ones that did not qualify, with the outcome of the
          latest run that checked it.
        </p>
      </header>
      <Panel id="jobs">
        <JobsTable
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
        />
      </Panel>
    </div>
  );
}
