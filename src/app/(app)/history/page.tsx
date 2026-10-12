import type { Metadata } from "next";
import { RunsTable } from "@/components/history/runs-table";
import { Panel } from "@/components/ui/panel";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/database/client";
import { resolvePagination } from "@/lib/validation/common";
import { parseSearchParams, type RawSearchParams } from "@/lib/validation/search-params";
import { listProfiles } from "@/modules/profiles/service";
import { runListQuery } from "@/modules/runs/list-query";
import { listRuns } from "@/modules/runs/service";
import { exportHref } from "@/lib/ui/export-href";

export const metadata: Metadata = { title: "Search History" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { actor } = await requireUser();
  const db = getDb();
  const query = parseSearchParams(runListQuery, await searchParams);
  const page = resolvePagination(query);
  const [{ items, total }, profiles] = await Promise.all([
    listRuns(db, actor, { ...query, ...page }),
    // Archived profiles stay in the filter: their runs remain part of the history.
    listProfiles(db, actor, { includeArchived: true }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[28px] leading-tight font-semibold">Search History</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Every run with the settings it used and what it found. Open a run to see each job and why it passed
          or failed.
        </p>
      </header>
      <Panel id="runs">
        <RunsTable
          rows={items}
          meta={{
            page: page.page,
            pageSize: page.pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / page.pageSize)),
          }}
          exportUrl={exportHref("/api/exports/runs.csv", query)}
          profiles={profiles.map((p) => ({
            value: p.id,
            label: p.archivedAt ? `${p.name} (archived)` : p.name,
          }))}
        />
      </Panel>
    </div>
  );
}
