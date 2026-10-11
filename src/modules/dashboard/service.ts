import { sql, type SQL } from "drizzle-orm";
import { ownerFilter, type Actor } from "@/lib/auth/authorization";
import type { Database } from "@/lib/database/client";
import { getIntegrationStatuses } from "@/modules/integrations/service";
import { listLeads } from "@/modules/jobs/queries";
import { countActiveProfiles } from "@/modules/profiles/service";
import type { Providers } from "@/modules/providers";
import { listRuns } from "@/modules/runs/service";

const SERIES_DAYS = 30;

function visibleRuns(actor: Actor): SQL {
  const owner = ownerFilter(actor);
  return owner
    ? sql`select r.* from agent_runs r join search_profiles p on p.id = r.profile_id where p.owner_user_id = ${owner}`
    : sql`select r.* from agent_runs r`;
}

/**
 * Dashboard read model. Every figure comes from the database at request time
 * (no caching, nothing estimated). Run-level totals are sums of per-run
 * counters, so a job seen by two runs is counted twice there;
 * `uniqueJobsDiscovered` counts each job once. Daily buckets use UTC dates.
 */
export async function getDashboard(db: Database, actor: Actor, providers: Providers) {
  const runs = visibleRuns(actor);

  const [totals] = await db.execute(sql`
    select count(*)::int as runs,
           coalesce(sum(source_count), 0)::int as discovered,
           coalesce(sum(hard_filter_pass_count), 0)::int as passed_hard_filters,
           coalesce(sum(ai_evaluated_count), 0)::int as ai_evaluated,
           coalesce(sum(qualified_count), 0)::int as qualified,
           coalesce(sum(rejected_count), 0)::int as rejected
    from (${runs}) r`);
  const [unique] = await db.execute(sql`
    select count(distinct rj.job_id)::int as jobs from run_jobs rj where rj.run_id in (select id from (${runs}) r)`);
  const [notes] = await db.execute(sql`
    select count(*) filter (where n.status in ('SENT', 'DELIVERED', 'READ'))::int as sent,
           count(*) filter (where n.status in ('FAILED_PERMANENT', 'FAILED_RETRYABLE', 'UNCERTAIN'))::int as failed
    from notifications n where n.run_id in (select id from (${runs}) r)`);
  const recentFailures = await db.execute(sql`
    select id, status, error_summary, created_at, finished_at from (${runs}) r
    where status in ('FAILED', 'BLOCKED_SOURCE', 'COMPLETED_WITH_ERRORS')
    order by created_at desc limit 5`);
  const [latestSuccess] = await db.execute(sql`
    select id, finished_at, qualified_count, notified_count from (${runs}) r
    where status = 'COMPLETED' order by finished_at desc nulls last limit 1`);
  const series = await db.execute(sql`
    select to_char(d, 'YYYY-MM-DD') as day,
           count(r.id)::int as runs,
           coalesce(sum(r.qualified_count), 0)::int as qualified,
           coalesce(sum(r.notified_count), 0)::int as notified
    from generate_series(
      (now() at time zone 'utc')::date - ${SERIES_DAYS - 1}::int,
      (now() at time zone 'utc')::date,
      interval '1 day'
    ) d
    left join (${runs}) r on (r.created_at at time zone 'utc')::date = d::date
    group by d order by d`);

  const recentRuns = await listRuns(db, actor, { page: 1, pageSize: 10, offset: 0 });
  const recentLeads = await listLeads(db, actor, {
    offset: 0,
    pageSize: 5,
    decision: ["QUALIFIED"],
    sort: "firstSeen",
    sortDir: "desc",
  });

  const num = (row: Record<string, unknown> | undefined, key: string) => Number(row?.[key] ?? 0);
  return {
    totals: {
      runs: num(totals, "runs"),
      jobsDiscovered: num(totals, "discovered"),
      uniqueJobsDiscovered: num(unique, "jobs"),
      passedHardFilters: num(totals, "passed_hard_filters"),
      aiEvaluated: num(totals, "ai_evaluated"),
      qualified: num(totals, "qualified"),
      rejected: num(totals, "rejected"),
      notificationsSent: num(notes, "sent"),
      notificationsFailed: num(notes, "failed"),
      activeProfiles: await countActiveProfiles(db, actor),
    },
    latestRun: recentRuns.items[0] ?? null,
    latestSuccessfulRun: latestSuccess
      ? {
          id: latestSuccess.id as string,
          finishedAt: latestSuccess.finished_at,
          qualified: Number(latestSuccess.qualified_count),
          notified: Number(latestSuccess.notified_count),
        }
      : null,
    recentFailures: recentFailures.map((r) => ({
      id: r.id as string,
      status: r.status as string,
      errorSummary: r.error_summary ?? null,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
    })),
    recentRuns: recentRuns.items,
    recentLeads: recentLeads.items,
    daily: series.map((r) => ({
      day: r.day as string,
      runs: Number(r.runs),
      qualified: Number(r.qualified),
      notified: Number(r.notified),
    })),
    integrations: await getIntegrationStatuses(db, providers),
  };
}
