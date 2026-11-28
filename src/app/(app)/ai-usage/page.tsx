import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DailyCostChart } from "@/components/ai-usage/daily-cost-chart";
import { MetricStrip } from "@/components/dashboard/metric-strip";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, Panel } from "@/components/ui/panel";
import { Time } from "@/components/ui/time";
import { hasRole } from "@/lib/auth/authorization";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/database/client";
import { cn } from "@/lib/ui/cn";
import { formatCount, formatMicroUsd, shortId } from "@/lib/ui/format";
import { q } from "@/lib/validation/common";
import { parseSearchParams, type RawSearchParams } from "@/lib/validation/search-params";
import { getAiUsage, USAGE_RANGES } from "@/modules/ai-usage/service";
import { getProviders } from "@/modules/providers";

export const metadata: Metadata = { title: "AI Usage" };

const query = z.object({ days: q.enumOf(USAGE_RANGES) });

const ms = (value: number | null) => (value === null ? "–" : `${formatCount(value)} ms`);

export default async function AiUsagePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { actor } = await requireUser();
  // Spend data is for operators and admins; viewers get a plain not-found page.
  if (!hasRole(actor, "OPERATOR")) notFound();
  const { days = "30" } = parseSearchParams(query, await searchParams);
  const data = await getAiUsage(getDb(), actor, days);
  const t = data.totals;
  const aiConfig = getProviders().ai.checkConfiguration();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight font-semibold">AI Usage</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Every OpenAI call made while scoring jobs, including retries. Costs are{" "}
            <strong className="font-medium text-ink">estimates</strong> from token counts and list prices;
            your OpenAI invoice is the source of truth.
          </p>
        </div>
        <nav aria-label="Time range" className="flex rounded-control border border-line bg-surface p-0.5">
          {USAGE_RANGES.map((range) => (
            <Link
              key={range}
              href={`/ai-usage?days=${range}`}
              aria-current={range === days ? "page" : undefined}
              className={cn(
                "rounded-[5px] px-3 py-1 text-[13px] font-medium text-muted hover:text-ink",
                range === days && "bg-accent-soft text-accent hover:text-accent",
              )}
            >
              {range} days
            </Link>
          ))}
        </nav>
      </header>

      {!aiConfig.configured && (
        <p role="status" className="rounded-panel border border-line bg-warning-soft px-4 py-3 text-[13px]">
          AI scoring is not configured ({aiConfig.message}), so no OpenAI calls are being made or recorded.
        </p>
      )}
      {t.unpricedCalls > 0 && (
        <p role="status" className="rounded-panel border border-line bg-warning-soft px-4 py-3 text-[13px]">
          {formatCount(t.unpricedCalls)} {t.unpricedCalls === 1 ? "call uses a model" : "calls use models"}{" "}
          with no known price, so the cost below leaves them out. See the model table and add the price to{" "}
          <code>src/modules/ai/pricing.ts</code>.
        </p>
      )}

      <MetricStrip
        label={`AI usage, last ${days} days`}
        metrics={[
          { label: "Estimated cost", value: 0, display: formatMicroUsd(t.costMicroUsd) },
          {
            label: "Cost per job",
            value: 0,
            display: formatMicroUsd(t.costPerJobMicroUsd),
            hint: `${formatCount(t.jobsEvaluated)} jobs scored`,
          },
          {
            label: "Cost per lead",
            value: 0,
            display: formatMicroUsd(t.costPerLeadMicroUsd),
            hint: `${formatCount(t.qualifiedLeads)} qualified leads`,
          },
          { label: "Calls", value: t.calls },
          { label: "Failed calls", value: t.failed, tone: "danger" },
          {
            label: "Input tokens",
            value: t.inputTokens,
            hint: `${formatCount(t.cachedInputTokens)} served from cache`,
          },
          { label: "Output tokens", value: t.outputTokens },
          {
            label: "Latency p50 / p95",
            value: 0,
            display: t.latencyP50Ms === null ? "–" : `${ms(t.latencyP50Ms)} / ${ms(t.latencyP95Ms)}`,
          },
        ]}
      />

      <Panel
        id="daily"
        title="Estimated cost per day"
        description="UTC days. Hover a bar for calls and tokens."
      >
        <div className="px-4 py-4">
          <DailyCostChart
            data={data.daily.map((d) => ({
              day: d.day,
              calls: d.calls,
              tokens: d.tokens,
              costUsd: Number(d.costMicroUsd) / 1_000_000,
              costLabel: formatMicroUsd(d.costMicroUsd),
            }))}
          />
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel id="by-model" title="By model">
          {data.byModel.length === 0 ? (
            <EmptyState title="No AI calls in this period" />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="tabular w-full text-left text-[13px]">
                <caption className="sr-only">AI usage by model</caption>
                <thead className="text-muted">
                  <tr className="border-b border-line">
                    <th scope="col" className="px-4 py-2 font-medium">
                      Model
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Calls
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Tokens in / out
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Avg latency
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Est. cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.byModel.map((m) => (
                    <tr key={m.model} className="border-b border-line last:border-0">
                      <td className="px-4 py-2">
                        <span className="font-medium">{m.model}</span>
                        {m.failed > 0 && <div className="text-muted">{formatCount(m.failed)} failed</div>}
                      </td>
                      <td className="px-4 py-2 text-right">{formatCount(m.calls)}</td>
                      <td className="px-4 py-2 text-right">
                        {formatCount(m.inputTokens)} / {formatCount(m.outputTokens)}
                      </td>
                      <td className="px-4 py-2 text-right">{ms(m.avgLatencyMs)}</td>
                      <td className="px-4 py-2 text-right">
                        {m.unpricedCalls > 0 ? (
                          <Badge tone="warning">No price</Badge>
                        ) : (
                          formatMicroUsd(m.costMicroUsd)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel id="by-profile" title="By search profile">
          {data.byProfile.length === 0 ? (
            <EmptyState title="No AI calls in this period" />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="tabular w-full text-left text-[13px]">
                <caption className="sr-only">AI usage by search profile</caption>
                <thead className="text-muted">
                  <tr className="border-b border-line">
                    <th scope="col" className="px-4 py-2 font-medium">
                      Profile
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Calls
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Tokens
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Est. cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.byProfile.map((p) => (
                    <tr key={p.profileId ?? "none"} className="border-b border-line last:border-0">
                      <td className="max-w-48 truncate px-4 py-2">
                        {p.profileId && p.name ? (
                          <Link
                            href={`/profiles/${p.profileId}`}
                            className="font-medium text-accent hover:underline"
                          >
                            {p.name}
                          </Link>
                        ) : (
                          <span className="text-muted">Removed profile</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">{formatCount(p.calls)}</td>
                      <td className="px-4 py-2 text-right">{formatCount(p.tokens)}</td>
                      <td className="px-4 py-2 text-right">{formatMicroUsd(p.costMicroUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel id="recent" title="Recent calls" description="The latest 25 calls, newest first.">
        {data.recent.length === 0 ? (
          <EmptyState title="No AI calls recorded yet">
            Calls appear here after the next run scores jobs with OpenAI. Calls made before this page existed
            were not recorded.
          </EmptyState>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="tabular w-full text-left text-[13px]">
              <caption className="sr-only">Most recent AI calls</caption>
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2 font-medium">
                    When
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Job
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Model
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Tokens in / out
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Latency
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Est. cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Time value={c.createdAt} />
                      {c.runId && (
                        <div>
                          <Link
                            href={`/run/${c.runId}`}
                            className="text-muted hover:text-accent hover:underline"
                          >
                            Run {shortId(c.runId)}
                          </Link>
                        </div>
                      )}
                    </td>
                    <td className="max-w-64 truncate px-4 py-2">
                      {c.jobId ? (
                        <Link
                          href={`/jobs/${c.jobId}`}
                          className="hover:text-accent hover:underline"
                          title={c.jobTitle ?? undefined}
                        >
                          {c.jobTitle ?? shortId(c.jobId)}
                        </Link>
                      ) : (
                        <span className="text-muted">–</span>
                      )}
                    </td>
                    <td className="px-4 py-2">{c.model}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={c.status} />
                      {c.attempt > 1 && <span className="ml-1 text-muted">try {c.attempt}</span>}
                      {c.httpStatus !== null && <span className="ml-1 text-muted">HTTP {c.httpStatus}</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {c.inputTokens === null
                        ? "–"
                        : `${formatCount(c.inputTokens)} / ${formatCount(c.outputTokens)}`}
                    </td>
                    <td className="px-4 py-2 text-right">{ms(c.latencyMs)}</td>
                    <td className="px-4 py-2 text-right">{formatMicroUsd(c.costMicroUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
