import { sql, type SQL } from "drizzle-orm";
import { hasRole, ownerFilter, requireRole, type Actor } from "@/lib/auth/authorization";
import type { Database } from "@/lib/database/client";
import type { AiCallStatus } from "@/types/domain";

export const USAGE_RANGES = ["7", "30", "90"] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

const RECENT_LIMIT = 25;

/**
 * Real (non-mock) model calls in the window, scoped like the rest of the app:
 * admins see every call, other users only calls made for profiles they own.
 */
function visibleCalls(actor: Actor, days: number): SQL {
  const owner = ownerFilter(actor);
  const since = sql`c.created_at >= now() - make_interval(days => ${days}::int)`;
  return owner
    ? sql`select c.* from ai_calls c join search_profiles p on p.id = c.profile_id
          where c.provider <> 'mock' and ${since} and p.owner_user_id = ${owner}`
    : sql`select c.* from ai_calls c where c.provider <> 'mock' and ${since}`;
}

type Row = Record<string, unknown>;
const int = (row: Row | undefined, key: string) => Number(row?.[key] ?? 0);
/** Cost sums arrive as text so bigint micro-USD never passes through a float. */
const micro = (row: Row | undefined, key: string): bigint => BigInt(String(row?.[key] ?? "0"));
const nullableInt = (row: Row, key: string) => (row[key] === null ? null : Number(row[key]));

/**
 * AI usage read model: calls, tokens, latency and estimated cost from the
 * ai_calls ledger. Costs are estimates from src/modules/ai/pricing.ts, not
 * OpenAI's invoice. Calls whose model has no known price are counted in
 * `unpricedCalls` and contribute nothing to the cost sums. Days are UTC.
 */
export async function getAiUsage(db: Database, actor: Actor, range: UsageRange) {
  requireRole(actor, "OPERATOR");
  const days = Number(range);
  const calls = visibleCalls(actor, days);

  const [totals] = await db.execute(sql`
    select count(*)::int as calls,
           count(*) filter (where status <> 'SUCCESS')::int as failed,
           count(distinct job_id)::int as jobs,
           coalesce(sum(input_tokens), 0)::bigint::text as input_tokens,
           coalesce(sum(cached_input_tokens), 0)::bigint::text as cached_input_tokens,
           coalesce(sum(output_tokens), 0)::bigint::text as output_tokens,
           coalesce(sum(cost_micro_usd), 0)::text as cost,
           count(*) filter (where cost_micro_usd is null and input_tokens is not null)::int as unpriced,
           percentile_disc(0.5) within group (order by latency_ms) as p50,
           percentile_disc(0.95) within group (order by latency_ms) as p95
    from (${calls}) c`);

  const daily = await db.execute(sql`
    select to_char(d, 'YYYY-MM-DD') as day,
           count(c.id)::int as calls,
           coalesce(sum(c.input_tokens + c.output_tokens), 0)::bigint::text as tokens,
           coalesce(sum(c.cost_micro_usd), 0)::text as cost
    from generate_series(
      (now() at time zone 'utc')::date - ${days - 1}::int,
      (now() at time zone 'utc')::date,
      interval '1 day'
    ) d
    left join (${calls}) c on (c.created_at at time zone 'utc')::date = d::date
    group by d order by d`);

  const byModel = await db.execute(sql`
    select model,
           count(*)::int as calls,
           count(*) filter (where status <> 'SUCCESS')::int as failed,
           coalesce(sum(input_tokens), 0)::bigint::text as input_tokens,
           coalesce(sum(output_tokens), 0)::bigint::text as output_tokens,
           coalesce(sum(cost_micro_usd), 0)::text as cost,
           count(*) filter (where cost_micro_usd is null and input_tokens is not null)::int as unpriced,
           round(avg(latency_ms))::int as avg_latency
    from (${calls}) c group by model order by sum(cost_micro_usd) desc nulls last, count(*) desc`);

  const byProfile = await db.execute(sql`
    select c.profile_id, p.name,
           count(*)::int as calls,
           coalesce(sum(c.input_tokens + c.output_tokens), 0)::bigint::text as tokens,
           coalesce(sum(c.cost_micro_usd), 0)::text as cost
    from (${calls}) c left join search_profiles p on p.id = c.profile_id
    group by c.profile_id, p.name order by sum(c.cost_micro_usd) desc nulls last, count(*) desc`);

  const recent = await db.execute(sql`
    select c.id, c.created_at, c.model, c.status, c.attempt, c.http_status, c.latency_ms,
           c.input_tokens, c.output_tokens, c.cost_micro_usd::text as cost, c.run_id, c.job_id, j.title
    from (${calls}) c left join jobs j on j.id = c.job_id
    order by c.created_at desc limit ${RECENT_LIMIT}`);

  // Qualified leads of every run that made a call in the window, for cost per lead. A run that straddles the
  // window start counts all its leads, so cost per lead is slightly understated at the window's edge.
  const [leads] = await db.execute(sql`
    select count(*)::int as qualified from qualifications q
    where q.decision = 'QUALIFIED'
      and q.run_id in (select distinct run_id from (${calls}) c where run_id is not null)`);

  const cost = micro(totals, "cost");
  const jobs = int(totals, "jobs");
  const qualified = int(leads, "qualified");
  return {
    range,
    totals: {
      calls: int(totals, "calls"),
      failed: int(totals, "failed"),
      jobsEvaluated: jobs,
      qualifiedLeads: qualified,
      inputTokens: int(totals, "input_tokens"),
      cachedInputTokens: int(totals, "cached_input_tokens"),
      outputTokens: int(totals, "output_tokens"),
      costMicroUsd: cost,
      unpricedCalls: int(totals, "unpriced"),
      latencyP50Ms: totals?.p50 == null ? null : Number(totals.p50),
      latencyP95Ms: totals?.p95 == null ? null : Number(totals.p95),
      costPerJobMicroUsd: jobs > 0 ? cost / BigInt(jobs) : null,
      costPerLeadMicroUsd: qualified > 0 ? cost / BigInt(qualified) : null,
    },
    daily: daily.map((r) => ({
      day: String(r.day),
      calls: int(r, "calls"),
      tokens: int(r, "tokens"),
      costMicroUsd: micro(r, "cost"),
    })),
    byModel: byModel.map((r) => ({
      model: String(r.model),
      calls: int(r, "calls"),
      failed: int(r, "failed"),
      inputTokens: int(r, "input_tokens"),
      outputTokens: int(r, "output_tokens"),
      costMicroUsd: micro(r, "cost"),
      unpricedCalls: int(r, "unpriced"),
      avgLatencyMs: int(r, "avg_latency"),
    })),
    byProfile: byProfile.map((r) => ({
      profileId: r.profile_id === null ? null : String(r.profile_id),
      name: r.name === null ? null : String(r.name),
      calls: int(r, "calls"),
      tokens: int(r, "tokens"),
      costMicroUsd: micro(r, "cost"),
    })),
    recent: recent.map((r) => ({
      id: String(r.id),
      createdAt: r.created_at as Date | string,
      model: String(r.model),
      status: r.status as AiCallStatus,
      attempt: int(r, "attempt"),
      httpStatus: nullableInt(r, "http_status"),
      latencyMs: int(r, "latency_ms"),
      inputTokens: nullableInt(r, "input_tokens"),
      outputTokens: nullableInt(r, "output_tokens"),
      costMicroUsd: r.cost === null ? null : BigInt(String(r.cost)),
      runId: r.run_id === null ? null : String(r.run_id),
      jobId: r.job_id === null ? null : String(r.job_id),
      jobTitle: r.title === null ? null : String(r.title),
    })),
  };
}

export type AiUsage = Awaited<ReturnType<typeof getAiUsage>>;

/** One-query spend summary for the main dashboard. Null for viewers, who cannot see spend. */
export async function getAiSpendSummary(db: Database, actor: Actor, range: UsageRange) {
  if (!hasRole(actor, "OPERATOR")) return null;
  const [row] = await db.execute(sql`
    select count(*)::int as calls, coalesce(sum(cost_micro_usd), 0)::text as cost
    from (${visibleCalls(actor, Number(range))}) c`);
  return { range, calls: int(row, "calls"), costMicroUsd: micro(row, "cost") };
}
