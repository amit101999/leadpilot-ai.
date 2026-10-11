import { sql, type SQL } from "drizzle-orm";
import { ownerFilter, type Actor } from "@/lib/auth/authorization";
import type { Database } from "@/lib/database/client";
import { notFound } from "@/lib/http/errors";
import type { JobProcessingStatus, NotificationStatus, QualificationDecision } from "@/types/domain";

/**
 * Read models for the All Jobs and Qualified Leads pages. Raw SQL is used for
 * the DISTINCT ON / lateral joins; every value is a bound parameter and every
 * sort column comes from a fixed allow-list.
 */

function scopeCondition(owner: string | null, alias: string): SQL {
  return owner ? sql`${sql.raw(alias)}.owner_user_id = ${owner}` : sql`true`;
}

function whereAll(parts: Array<SQL | undefined>): SQL {
  const present = parts.filter((p): p is SQL => Boolean(p));
  return present.length ? sql.join(present, sql` and `) : sql`true`;
}

export interface JobListFilters {
  offset: number;
  pageSize: number;
  profileId?: string;
  status?: JobProcessingStatus[];
  search?: string;
  previouslySeen?: boolean;
  notified?: boolean;
  source?: string;
  sort?: "firstSeen" | "lastChecked" | "budget" | "score" | "title";
  sortDir?: "asc" | "desc";
}

const JOB_SORT: Record<NonNullable<JobListFilters["sort"]>, string> = {
  firstSeen: "t.first_seen_at",
  lastChecked: "t.last_checked_at",
  budget: "t.budget_amount",
  score: "t.score",
  title: "lower(t.title)",
};

export async function listJobs(db: Database, actor: Actor, f: JobListFilters) {
  const owner = ownerFilter(actor);
  const base = sql`
    with latest as (
      select distinct on (rj.job_id) rj.*, r.profile_id, r.created_at as run_created_at
      from run_jobs rj
      join agent_runs r on r.id = rj.run_id
      join search_profiles p on p.id = r.profile_id
      where ${scopeCondition(owner, "p")} ${f.profileId ? sql`and r.profile_id = ${f.profileId}` : sql``}
      order by rj.job_id, r.created_at desc
    )
    select j.id, j.source, j.source_job_id, j.title, j.job_url, j.budget_type, j.budget_amount, j.budget_max,
           j.hourly_min, j.hourly_max, j.currency, j.payment_verified, j.skills, j.first_seen_at, j.last_seen_at,
           l.run_id as latest_run_id, l.processing_status, l.rejection_reasons, l.previously_seen,
           l.updated_at as last_checked_at, q.score, q.decision,
           exists (
             select 1 from notifications n
             join agent_runs r2 on r2.id = n.run_id
             join search_profiles p2 on p2.id = r2.profile_id
             where n.job_id = j.id and n.status in ('SENT', 'DELIVERED', 'READ') and ${scopeCondition(owner, "p2")}
           ) as notified
    from latest l
    join jobs j on j.id = l.job_id
    left join qualifications q on q.run_id = l.run_id and q.job_id = l.job_id`;

  const filters = whereAll([
    f.status?.length
      ? sql`l.processing_status in (${sql.join(
          f.status.map((s) => sql`${s}`),
          sql`, `,
        )})`
      : undefined,
    f.search
      ? sql`(j.title ilike ${`%${escapeLike(f.search)}%`} or j.source_job_id = ${f.search})`
      : undefined,
    f.previouslySeen !== undefined ? sql`l.previously_seen = ${f.previouslySeen}` : undefined,
    f.source ? sql`j.source = ${f.source}` : undefined,
  ]);
  const notifiedFilter = f.notified === undefined ? sql`true` : sql`t.notified = ${f.notified}`;

  const rows = await db.execute(sql`
    select * from (${base} where ${filters}) t where ${notifiedFilter}
    order by ${sql.raw(JOB_SORT[f.sort ?? "firstSeen"])} ${sql.raw(f.sortDir === "asc" ? "asc" : "desc")} nulls last, t.id
    limit ${f.pageSize} offset ${f.offset}`);
  const [count] = await db.execute(
    sql`select count(*)::int as total from (${base} where ${filters}) t where ${notifiedFilter}`,
  );
  return { items: rows.map(mapJobListRow), total: Number((count as { total?: number })?.total ?? 0) };
}

function mapJobListRow(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    source: row.source as string,
    sourceJobId: row.source_job_id as string,
    title: row.title as string,
    jobUrl: row.job_url as string | null,
    budgetType: row.budget_type as string,
    budgetAmount: row.budget_amount as string | null,
    budgetMax: row.budget_max as string | null,
    hourlyMin: row.hourly_min as string | null,
    hourlyMax: row.hourly_max as string | null,
    currency: row.currency as string | null,
    paymentVerified: row.payment_verified as boolean | null,
    skills: (row.skills as string[]) ?? [],
    firstSeenAt: toDate(row.first_seen_at),
    lastSeenAt: toDate(row.last_seen_at),
    latestRunId: row.latest_run_id as string,
    processingStatus: row.processing_status as JobProcessingStatus,
    rejectionReasons: (row.rejection_reasons as string[]) ?? [],
    previouslySeen: Boolean(row.previously_seen),
    lastCheckedAt: toDate(row.last_checked_at),
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    decision: (row.decision as QualificationDecision | null) ?? null,
    notified: Boolean(row.notified),
  };
}
export type JobListItem = ReturnType<typeof mapJobListRow>;

export interface LeadListFilters {
  offset: number;
  pageSize: number;
  profileId?: string;
  decision?: QualificationDecision[];
  budgetMin?: string;
  budgetMax?: string;
  scoreMin?: number;
  scoreMax?: number;
  skill?: string;
  paymentVerified?: "true" | "false" | "unknown";
  discoveredFrom?: Date;
  discoveredTo?: Date;
  notificationStatus?: Array<NotificationStatus | "NONE">;
  search?: string;
  sort?: "score" | "firstSeen" | "lastChecked" | "budget";
  sortDir?: "asc" | "desc";
}

const LEAD_SORT: Record<NonNullable<LeadListFilters["sort"]>, string> = {
  score: "t.score",
  firstSeen: "t.first_seen_at",
  lastChecked: "t.evaluated_at",
  budget: "t.budget_amount",
};

export async function listLeads(db: Database, actor: Actor, f: LeadListFilters) {
  const owner = ownerFilter(actor);
  const decisions = f.decision?.length ? f.decision : (["QUALIFIED"] as QualificationDecision[]);
  const notificationStatuses = (f.notificationStatus ?? []).filter((s) => s !== "NONE");
  const base = sql`
    with latest as (
      select distinct on (q.job_id) q.*, r.profile_id, p.name as profile_name
      from qualifications q
      join agent_runs r on r.id = q.run_id
      join search_profiles p on p.id = r.profile_id
      where ${scopeCondition(owner, "p")} ${f.profileId ? sql`and r.profile_id = ${f.profileId}` : sql``}
      order by q.job_id, q.evaluated_at desc
    )
    select j.id, j.source, j.source_job_id, j.title, j.job_url, j.budget_type, j.budget_amount, j.budget_max,
           j.currency, j.payment_verified, j.skills, j.first_seen_at,
           l.run_id, l.profile_id, l.profile_name, l.score, l.decision, l.evaluated_at, l.risk_flags,
           l.evidence -> 'skillMatches' as skill_matches,
           n.status as notification_status, n.id as notification_id, n.sent_at as notification_sent_at
    from latest l
    join jobs j on j.id = l.job_id
    left join lateral (
      select n.status, n.id, n.sent_at from notifications n
      join agent_runs r3 on r3.id = n.run_id
      join search_profiles p3 on p3.id = r3.profile_id
      where n.job_id = j.id and ${scopeCondition(owner, "p3")}
      order by n.updated_at desc limit 1
    ) n on true`;

  const filters = whereAll([
    sql`l.decision in (${sql.join(
      decisions.map((d) => sql`${d}`),
      sql`, `,
    )})`,
    f.budgetMin ? sql`j.budget_amount >= ${f.budgetMin}::numeric` : undefined,
    f.budgetMax ? sql`j.budget_amount <= ${f.budgetMax}::numeric` : undefined,
    f.scoreMin !== undefined ? sql`l.score >= ${f.scoreMin}` : undefined,
    f.scoreMax !== undefined ? sql`l.score <= ${f.scoreMax}` : undefined,
    f.skill
      ? sql`exists (select 1 from jsonb_array_elements_text(j.skills) s where s ilike ${`%${escapeLike(f.skill)}%`})`
      : undefined,
    f.paymentVerified === "true"
      ? sql`j.payment_verified = true`
      : f.paymentVerified === "false"
        ? sql`j.payment_verified = false`
        : f.paymentVerified === "unknown"
          ? sql`j.payment_verified is null`
          : undefined,
    f.discoveredFrom ? sql`j.first_seen_at >= ${f.discoveredFrom}` : undefined,
    f.discoveredTo ? sql`j.first_seen_at <= ${f.discoveredTo}` : undefined,
    f.notificationStatus?.length
      ? sql`(${
          notificationStatuses.length
            ? sql`n.status in (${sql.join(
                notificationStatuses.map((s) => sql`${s}`),
                sql`, `,
              )})`
            : sql`false`
        } ${f.notificationStatus.includes("NONE") ? sql`or n.status is null` : sql``})`
      : undefined,
    f.search ? sql`j.title ilike ${`%${escapeLike(f.search)}%`}` : undefined,
  ]);

  const rows = await db.execute(sql`
    select * from (${base} where ${filters}) t
    order by ${sql.raw(LEAD_SORT[f.sort ?? "score"])} ${sql.raw(f.sortDir === "asc" ? "asc" : "desc")} nulls last, t.first_seen_at asc, t.source_job_id asc
    limit ${f.pageSize} offset ${f.offset}`);
  const [count] = await db.execute(sql`select count(*)::int as total from (${base} where ${filters}) t`);
  return { items: rows.map(mapLeadRow), total: Number((count as { total?: number })?.total ?? 0) };
}

function mapLeadRow(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    source: row.source as string,
    sourceJobId: row.source_job_id as string,
    title: row.title as string,
    jobUrl: row.job_url as string | null,
    budgetType: row.budget_type as string,
    budgetAmount: row.budget_amount as string | null,
    budgetMax: row.budget_max as string | null,
    currency: row.currency as string | null,
    paymentVerified: row.payment_verified as boolean | null,
    skills: (row.skills as string[]) ?? [],
    skillMatches: (row.skill_matches as string[] | null) ?? [],
    firstSeenAt: toDate(row.first_seen_at),
    runId: row.run_id as string,
    profileId: row.profile_id as string,
    profileName: row.profile_name as string,
    score: row.score === null ? null : Number(row.score),
    decision: row.decision as QualificationDecision,
    evaluatedAt: toDate(row.evaluated_at),
    riskFlags: (row.risk_flags as Array<{ code: string; severity: string }>) ?? [],
    notificationStatus: (row.notification_status as NotificationStatus | null) ?? null,
    notificationId: (row.notification_id as string | null) ?? null,
    notificationSentAt: toDate(row.notification_sent_at),
  };
}
export type LeadListItem = ReturnType<typeof mapLeadRow>;

/** Full job detail: every run/evaluation/notification the actor is allowed to see. */
export async function getJobDetail(db: Database, actor: Actor, jobId: string) {
  const owner = ownerFilter(actor);
  const visibleRuns = sql`
    select r.id from agent_runs r join search_profiles p on p.id = r.profile_id where ${scopeCondition(owner, "p")}`;

  const [job] = await db.execute(sql`
    select * from jobs j
    where j.id = ${jobId} and exists (select 1 from run_jobs rj where rj.job_id = j.id and rj.run_id in (${visibleRuns}))`);
  if (!job) throw notFound("Job");

  const runJobRows = await db.execute(sql`
    select rj.*, r.created_at as run_created_at, r.status as run_status, p.name as profile_name, p.id as profile_id
    from run_jobs rj join agent_runs r on r.id = rj.run_id join search_profiles p on p.id = r.profile_id
    where rj.job_id = ${jobId} and rj.run_id in (${visibleRuns})
    order by r.created_at desc`);
  const qualificationRows = await db.execute(sql`
    select q.* from qualifications q where q.job_id = ${jobId} and q.run_id in (${visibleRuns})
    order by q.evaluated_at desc`);
  const notificationRows = await db.execute(sql`
    select n.id, n.run_id, n.status, n.channel, n.provider_message_id, n.attempts, n.message_preview,
           n.reserved_at, n.sent_at, n.delivered_at, n.read_at, n.last_error, n.created_at, n.updated_at,
           rc.label as recipient_label
    from notifications n join notification_recipients rc on rc.id = n.recipient_id
    where n.job_id = ${jobId} and n.run_id in (${visibleRuns})`);
  const attemptRows = notificationRows.length
    ? await db.execute(sql`
        select a.* from notification_attempts a
        where a.notification_id in (${sql.join(
          notificationRows.map((n) => sql`${n.id as string}`),
          sql`, `,
        )})
        order by a.started_at desc`)
    : [];

  return {
    job: camelize(job),
    runs: runJobRows.map(camelize),
    qualifications: qualificationRows.map(camelize),
    notifications: notificationRows.map(camelize),
    attempts: attemptRows.map(camelize),
  };
}

/** Jobs of one run (run detail page), grouped by outcome on the client. */
export async function listRunJobs(db: Database, actor: Actor, runId: string) {
  const owner = ownerFilter(actor);
  const rows = await db.execute(sql`
    select rj.id as run_job_id, rj.processing_status, rj.hard_check_results, rj.rejection_reasons, rj.previously_seen,
           rj.rank, rj.notification_note, rj.ai_attempts,
           j.id, j.source, j.source_job_id, j.title, j.job_url, j.budget_type, j.budget_amount, j.budget_max,
           j.hourly_min, j.currency, j.payment_verified, j.skills,
           q.score, q.decision, q.dimension_scores, q.risk_flags, q.decision_reasons, q.error as ai_error,
           q.evidence -> 'reasoningSummary' as reasoning_summary
    from run_jobs rj
    join agent_runs r on r.id = rj.run_id
    join search_profiles p on p.id = r.profile_id
    join jobs j on j.id = rj.job_id
    left join qualifications q on q.run_id = rj.run_id and q.job_id = rj.job_id
    where rj.run_id = ${runId} and ${scopeCondition(owner, "p")}
    order by rj.rank asc nulls last, q.score desc nulls last, j.title asc`);
  return rows.map(camelize);
}

function camelize(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      value,
    ]),
  );
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
