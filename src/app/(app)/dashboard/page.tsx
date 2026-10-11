import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DailyChart } from "@/components/dashboard/daily-chart";
import { MetricStrip } from "@/components/dashboard/metric-strip";
import { FunnelRail } from "@/components/runs/funnel-rail";
import { toLaunchable } from "@/components/runs/launchable";
import { RunLauncher } from "@/components/runs/run-launcher";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, Panel } from "@/components/ui/panel";
import { Time } from "@/components/ui/time";
import { hasRole } from "@/lib/auth/authorization";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/database/client";
import { isSafeLinkHref } from "@/lib/security/url";
import { formatCount, formatMoney, shortId } from "@/lib/ui/format";
import { getDashboard } from "@/modules/dashboard/service";
import { listProfiles } from "@/modules/profiles/service";
import { getProviders } from "@/modules/providers";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { actor } = await requireUser();
  const db = getDb();
  const [data, profiles] = await Promise.all([
    getDashboard(db, actor, getProviders()),
    listProfiles(db, actor),
  ]);
  const launchable = toLaunchable(profiles);
  const defaultProfile = launchable.find((p) => p.isDefault) ?? launchable[0];
  const latest = data.latestRun;
  const t = data.totals;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            {formatCount(t.activeProfiles)} active search {t.activeProfiles === 1 ? "profile" : "profiles"}.{" "}
            {data.latestSuccessfulRun ? (
              <>
                Last successful run finished <Time value={data.latestSuccessfulRun.finishedAt} />.
              </>
            ) : (
              "No successful run yet."
            )}
          </p>
        </div>
        <RunLauncher
          profiles={launchable}
          selectedId={defaultProfile?.id ?? null}
          canRun={hasRole(actor, "OPERATOR")}
        />
      </header>

      <MetricStrip
        label="Totals across all runs"
        metrics={[
          { label: "Runs", value: t.runs },
          {
            label: "Jobs discovered",
            value: t.jobsDiscovered,
            hint: `${t.uniqueJobsDiscovered} unique jobs`,
          },
          { label: "Passed rules", value: t.passedHardFilters },
          { label: "AI evaluated", value: t.aiEvaluated },
          { label: "Qualified", value: t.qualified },
          { label: "Rejected", value: t.rejected },
          { label: "Alerts sent", value: t.notificationsSent },
          { label: "Alerts failed", value: t.notificationsFailed, tone: "danger" },
        ]}
      />

      <Panel
        id="latest-run"
        title="Latest run"
        description={
          latest ? (
            <>
              {latest.profileName}, started <Time value={latest.createdAt} />
            </>
          ) : undefined
        }
        actions={
          latest && (
            <>
              {latest.sourceProvider === "mock" && <Badge tone="warning">Mock source</Badge>}
              <StatusBadge status={latest.status} />
              <Link
                href={`/run/${latest.id}`}
                className="text-[13px] font-medium text-accent hover:underline"
              >
                View run
              </Link>
            </>
          )
        }
      >
        {latest ? (
          <div className="px-4 py-4">
            <FunnelRail
              counts={{
                discovered: latest.sourceCount,
                passedFilters: latest.hardFilterPassCount,
                evaluated: latest.aiEvaluatedCount,
                qualified: latest.qualifiedCount,
                notified: latest.notifiedCount,
              }}
            />
          </div>
        ) : (
          <EmptyState title="No runs yet">
            Pick a search profile above and select Run agent to find your first leads.
          </EmptyState>
        )}
      </Panel>

      <Panel
        id="daily"
        title="Last 30 days"
        description="Qualified leads and WhatsApp alerts sent per day (UTC)."
      >
        <div className="px-4 py-4">
          <DailyChart data={data.daily} />
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel id="recent-runs" title="Recent runs">
          {data.recentRuns.length === 0 ? (
            <EmptyState title="No runs yet">Runs you start appear here with their results.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="tabular w-full text-left text-[13px]">
                <caption className="sr-only">Most recent runs</caption>
                <thead className="text-muted">
                  <tr className="border-b border-line">
                    <th scope="col" className="px-4 py-2 font-medium">
                      Run
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Profile
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Qualified
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Sent
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentRuns.map((run) => (
                    <tr key={run.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2">
                        <Link href={`/run/${run.id}`} className="font-medium text-accent hover:underline">
                          {shortId(run.id)}
                        </Link>
                        <div className="text-muted">
                          <Time value={run.createdAt} />
                        </div>
                      </td>
                      <td className="max-w-40 truncate px-4 py-2">{run.profileName}</td>
                      <td className="px-4 py-2">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="px-4 py-2 text-right">{formatCount(run.qualifiedCount)}</td>
                      <td className="px-4 py-2 text-right">{formatCount(run.notifiedCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel id="recent-leads" title="Recent qualified leads">
          {data.recentLeads.length === 0 ? (
            <EmptyState title="No qualified leads yet">
              Jobs that pass every rule and score at least the profile&apos;s minimum appear here.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {data.recentLeads.map((lead) => (
                <li
                  key={`${lead.runId}-${lead.id}`}
                  className="flex items-start justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={lead.title}>
                      {lead.title}
                    </p>
                    <p className="tabular text-[13px] text-muted">
                      {formatMoney(lead.budgetAmount, lead.currency)}, {lead.profileName}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="tabular text-sm font-semibold" title="AI match score">
                      {lead.score ?? "–"}
                      <span className="text-[13px] font-normal text-muted">/100</span>
                    </span>
                    {isSafeLinkHref(lead.jobUrl) && (
                      <a
                        href={lead.jobUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted hover:text-ink"
                        aria-label={`Open job posting: ${lead.title}`}
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          id="integrations"
          title="Integration health"
          description="Result of the last connection test. Tests run from the Integrations page."
        >
          <ul className="divide-y divide-line">
            {data.integrations.map((integration) => (
              <li
                key={integration.name}
                className="flex items-center justify-between gap-4 px-4 py-2.5 text-[13px]"
              >
                <span className="font-medium">{INTEGRATION_NAMES[integration.name] ?? integration.name}</span>
                <span className="flex items-center gap-2 text-muted">
                  {integration.status ? (
                    <>
                      {integration.stale && <span>Checked over an hour ago</span>}
                      <StatusBadge status={integration.status} />
                    </>
                  ) : (
                    <span>Not tested yet</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          id="failures"
          title="Recent problems"
          description="Runs that failed, were blocked or finished with errors."
        >
          {data.recentFailures.length === 0 ? (
            <EmptyState title="No problems in recent runs" />
          ) : (
            <ul className="divide-y divide-line">
              {data.recentFailures.map((run) => (
                <li key={run.id} className="flex items-start justify-between gap-4 px-4 py-2.5 text-[13px]">
                  <div className="min-w-0">
                    <Link href={`/run/${run.id}`} className="font-medium text-accent hover:underline">
                      Run {shortId(run.id)}
                    </Link>
                    <p className="truncate text-muted">
                      {run.errorSummary?.message ?? "See the run for details."}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={run.status} />
                    <span className="text-muted">
                      <Time value={run.createdAt} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

const INTEGRATION_NAMES: Record<string, string> = {
  database: "Database",
  job_source: "Job source",
  ai: "AI scoring",
  whatsapp: "WhatsApp",
  n8n: "n8n workflows",
};
