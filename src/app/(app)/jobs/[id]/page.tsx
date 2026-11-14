import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Badge, StatusBadge, type BadgeTone } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState, Panel } from "@/components/ui/panel";
import { Time } from "@/components/ui/time";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/database/client";
import { AppError } from "@/lib/http/errors";
import { isSafeLinkHref } from "@/lib/security/url";
import { formatMoney, shortId } from "@/lib/ui/format";
import { uuidParam } from "@/lib/validation/common";
import { getJobDetail } from "@/modules/jobs/queries";

export const metadata: Metadata = { title: "Job details" };

interface Job {
  id: string;
  source: string;
  sourceJobId: string;
  title: string;
  description: string;
  jobUrl: string | null;
  budgetType: string;
  budgetAmount: string | null;
  budgetMax: string | null;
  hourlyMin: string | null;
  hourlyMax: string | null;
  currency: string | null;
  paymentVerified: boolean | null;
  clientRating: string | null;
  clientHires: number | null;
  clientTotalSpent: string | null;
  clientCountry: string | null;
  skills: string[];
  category: string | null;
  postedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  sourceMetadata?: Record<string, unknown> | null;
}

/** Extra data stored by the Upwork import (src/modules/job-sources/upwork-import/normalize.ts). */
interface UpworkImportMetadata {
  origin?: string;
  detailsFetched?: boolean;
  experienceLevel?: string | null;
  duration?: string | null;
  proposalsTier?: string | null;
  client?: {
    totalPostedJobs?: number | null;
    totalReviews?: number | null;
    hireRatePercent?: number | null;
    openJobs?: number | null;
  };
  job?: { totalHired?: number | null; invitesSent?: number | null; connectsCost?: number | null };
}

const known = (value: string | number | null | undefined, suffix = "") =>
  value === null || value === undefined ? "Unknown" : `${value}${suffix}`;
interface CheckResult {
  rule: string;
  outcome: string;
  message: string;
}
interface RunJob {
  runId: string;
  processingStatus: string;
  hardCheckResults: CheckResult[];
  rejectionReasons: string[];
  notificationNote: string | null;
  runCreatedAt: Date;
  runStatus: string;
  profileName: string;
}
interface DimensionDetail {
  evidence: string[];
  explanation: string;
  missing_information: string[];
}
interface Qualification {
  runId: string;
  score: number | null;
  dimensionScores: Record<string, number> | null;
  decision: string;
  decisionReasons: string[];
  promptVersion: string;
  rubricVersion: string;
  modelIdentifier: string;
  evidence: {
    dimensionDetails?: Record<string, DimensionDetail>;
    skillMatches?: string[];
    scopeSummary?: string;
    positiveSignals?: string[];
    reasoningSummary?: string;
  };
  riskFlags: Array<{ code: string; severity: string; evidence?: string }>;
  missingInformation: string[];
  attempts: number;
  error: string | null;
  evaluatedAt: Date;
}
interface NotificationRow {
  id: string;
  runId: string;
  status: string;
  attempts: number;
  messagePreview: string;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  lastError: string | null;
  recipientLabel: string;
}
interface Attempt {
  notificationId: string;
  attemptNumber: number;
  outcome: string;
  httpStatus: number | null;
  error: string | null;
  manual: boolean;
  startedAt: Date;
}

const DIMENSION_LABELS: Record<string, string> = {
  skill_alignment: "Skill alignment",
  scope_fit: "Scope and service fit",
  description_clarity: "Description clarity",
  client_credibility: "Client credibility",
  overall_relevance: "Overall relevance",
};

const OUTCOME_TONE: Record<string, BadgeTone> = {
  PASS: "success",
  FAIL: "danger",
  UNKNOWN: "warning",
  NOT_APPLICABLE: "neutral",
};
const OUTCOME_LABEL: Record<string, string> = {
  PASS: "Pass",
  FAIL: "Fail",
  UNKNOWN: "Unknown",
  NOT_APPLICABLE: "Not applicable",
};
const SEVERITY_TONE: Record<string, BadgeTone> = { LOW: "neutral", MEDIUM: "warning", HIGH: "danger" };

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-x-8 gap-y-2.5 px-4 py-4 text-sm sm:grid-cols-[200px_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireUser();
  const parsed = uuidParam.safeParse((await params).id);
  if (!parsed.success) notFound();
  let detail;
  try {
    detail = await getJobDetail(getDb(), actor, parsed.data);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  // Rows come from raw SQL (camel-cased); these shapes mirror the jobs, run_jobs, qualifications,
  // notifications and notification_attempts tables.
  const job = detail.job as unknown as Job;
  const runs = detail.runs as unknown as RunJob[];
  const qualifications = detail.qualifications as unknown as Qualification[];
  const notifications = detail.notifications as unknown as NotificationRow[];
  const attempts = detail.attempts as unknown as Attempt[];
  const latestRun = runs[0];
  const latest = qualifications[0];

  const upwork = (job.sourceMetadata ?? null) as UpworkImportMetadata | null;
  const budget =
    job.budgetType === "HOURLY"
      ? `${formatMoney(job.hourlyMin, job.currency)}–${formatMoney(job.hourlyMax, job.currency)} per hour`
      : job.budgetMax
        ? `${formatMoney(job.budgetAmount, job.currency)}–${formatMoney(job.budgetMax, job.currency)} (the lower bound is used)`
        : formatMoney(job.budgetAmount, job.currency);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-muted">
          <Link href="/jobs" className="hover:text-ink hover:underline">
            All Jobs
          </Link>
        </p>
        <h1 className="max-w-3xl text-2xl leading-tight font-semibold">{job.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
          <span>
            {job.source}, {job.sourceJobId}
          </span>
          {job.source === "mock" && <Badge tone="warning">Mock source</Badge>}
          {latestRun && <StatusBadge status={latestRun.processingStatus} />}
          {isSafeLinkHref(job.jobUrl) ? (
            <>
              <a
                href={job.jobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
              >
                <ExternalLink className="size-4" />
                Open original posting
              </a>
              <CopyButton value={job.jobUrl} label="Copy job link" />
            </>
          ) : (
            <span>No valid job link from the source</span>
          )}
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Panel
          id="facts"
          title="Job facts"
          description="As supplied by the job source. Unknown means the source did not say."
        >
          <Facts
            rows={[
              ["Budget", budget],
              [
                "Payment verified",
                job.paymentVerified === null ? "Unknown" : job.paymentVerified ? "Yes" : "No",
              ],
              ["Client rating", job.clientRating ?? "Unknown"],
              ["Client hires", job.clientHires ?? "Unknown"],
              [
                "Client spend",
                job.clientTotalSpent ? formatMoney(job.clientTotalSpent, job.currency) : "Unknown",
              ],
              ["Client country", job.clientCountry ?? "Unknown"],
              [
                "Skills",
                job.skills.length ? (
                  <span className="flex flex-wrap gap-1">
                    {job.skills.map((s) => (
                      <Badge key={s}>{s}</Badge>
                    ))}
                  </span>
                ) : (
                  "None listed"
                ),
              ],
              ["Category", job.category ?? "Unknown"],
              ["Posted", <Time key="posted" value={job.postedAt} fallback="Unknown" />],
              ["First found", <Time key="first" value={job.firstSeenAt} />],
              ["Last seen", <Time key="last" value={job.lastSeenAt} />],
            ]}
          />
        </Panel>

        <Panel
          id="description"
          title="Description"
          description="Text from the job posting, shown exactly as received."
        >
          <p className="max-h-[28rem] overflow-y-auto px-4 py-4 text-sm whitespace-pre-wrap">
            {job.description || "The source supplied no description."}
          </p>
        </Panel>
      </div>

      {upwork?.origin === "upwork-mcp" && (
        <Panel
          id="upwork-details"
          title="Upwork details"
          description={
            upwork.detailsFetched
              ? "Imported by the Upwork sync, including the client's full hiring record."
              : "Imported by the Upwork sync from search results; the client's full hiring record was not fetched."
          }
        >
          <Facts
            rows={[
              ["Experience level", known(upwork.experienceLevel)],
              ["Expected duration", known(upwork.duration)],
              ["Proposals so far", known(upwork.proposalsTier)],
              ["Client jobs posted", known(upwork.client?.totalPostedJobs)],
              ["Client reviews", known(upwork.client?.totalReviews)],
              ["Client hire rate", known(upwork.client?.hireRatePercent, "%")],
              ["Client open jobs", known(upwork.client?.openJobs)],
              ["Hired on this job", known(upwork.job?.totalHired)],
              ["Connects to apply", known(upwork.job?.connectsCost)],
            ]}
          />
        </Panel>
      )}

      <Panel
        id="assessment"
        title="AI assessment"
        description={
          latest
            ? `From the latest evaluation. The final score is calculated by LeadPilot from the dimension scores and the profile's weights.`
            : undefined
        }
        actions={
          latest && (
            <>
              <span className="tabular text-xl font-semibold">
                {latest.score ?? "–"}
                <span className="text-sm font-normal text-muted">/100</span>
              </span>
              <StatusBadge status={latest.decision} />
            </>
          )
        }
      >
        {!latest ? (
          <EmptyState title="Not evaluated by AI">
            Jobs that fail a rule are rejected before AI scoring, so they have no assessment.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-4 px-4 py-4 text-sm">
            {latest.error && <p className="text-danger">AI error: {latest.error}</p>}
            {latest.evidence.reasoningSummary && <p>{latest.evidence.reasoningSummary}</p>}
            {latest.decisionReasons.length > 0 && (
              <div>
                <h3 className="font-medium">Decision</h3>
                <ul className="mt-1 list-disc pl-5 text-muted">
                  {latest.decisionReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {latest.dimensionScores && (
              <ul className="grid gap-4 md:grid-cols-2">
                {Object.entries(DIMENSION_LABELS).map(([key, label]) => {
                  const value = latest.dimensionScores?.[key];
                  const detail = latest.evidence.dimensionDetails?.[key];
                  // Models sometimes repeat the explanation as evidence; show each statement once.
                  const evidence = (detail?.evidence ?? []).filter((e) => e !== detail?.explanation);
                  return (
                    <li key={key} className="rounded-control border border-line p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{label}</span>
                        <span className="tabular font-semibold">{value ?? "–"}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-sunken" aria-hidden>
                        <div className="h-1.5 rounded-full bg-accent" style={{ width: `${value ?? 0}%` }} />
                      </div>
                      {detail?.explanation && <p className="mt-2 text-[13px]">{detail.explanation}</p>}
                      {evidence.length ? (
                        <ul className="mt-1 list-disc pl-5 text-[13px] text-muted">
                          {evidence.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      ) : null}
                      {detail?.missing_information?.length ? (
                        <p className="mt-1 text-[13px] text-warning">
                          Missing: {detail.missing_information.join("; ")}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {latest.riskFlags.length > 0 && (
              <div>
                <h3 className="font-medium">Risk flags</h3>
                <ul className="mt-1 flex flex-col gap-1.5">
                  {latest.riskFlags.map((flag) => (
                    <li key={flag.code} className="flex flex-wrap items-start gap-2">
                      <Badge tone={SEVERITY_TONE[flag.severity] ?? "neutral"}>
                        {flag.severity.charAt(0) + flag.severity.slice(1).toLowerCase()}
                      </Badge>
                      <span className="font-medium">{flag.code.replace(/_/g, " ").toLowerCase()}</span>
                      {flag.evidence && <span className="text-muted">{flag.evidence}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {latest.missingInformation.length > 0 && (
              <p className="text-muted">
                Information the AI could not find: {latest.missingInformation.join("; ")}
              </p>
            )}
            <p className="text-[13px] text-muted">
              Model {latest.modelIdentifier}, prompt {latest.promptVersion}, rubric {latest.rubricVersion},{" "}
              {latest.attempts} {latest.attempts === 1 ? "attempt" : "attempts"}, evaluated{" "}
              <Time value={latest.evaluatedAt} />.
            </p>
          </div>
        )}
      </Panel>

      <Panel
        id="checks"
        title="Rule checks"
        description={
          latestRun ? (
            <>
              From run{" "}
              <Link href={`/history/${latestRun.runId}`} className="text-accent hover:underline">
                {shortId(latestRun.runId)}
              </Link>
              . Unknown means the source did not provide the data needed to check the rule.
            </>
          ) : undefined
        }
      >
        {!latestRun || latestRun.hardCheckResults.length === 0 ? (
          <EmptyState title="No rule checks recorded" />
        ) : (
          <ul className="divide-y divide-line">
            {latestRun.hardCheckResults.map((check) => (
              <li key={check.rule} className="flex items-start justify-between gap-4 px-4 py-2.5 text-[13px]">
                <span>{check.message}</span>
                <Badge tone={OUTCOME_TONE[check.outcome] ?? "neutral"}>
                  {OUTCOME_LABEL[check.outcome] ?? check.outcome}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel id="runs" title="Runs that checked this job">
          <ul className="divide-y divide-line">
            {runs.map((run) => (
              <li key={run.runId} className="flex items-start justify-between gap-4 px-4 py-2.5 text-[13px]">
                <div className="min-w-0">
                  <Link href={`/history/${run.runId}`} className="font-medium text-accent hover:underline">
                    Run {shortId(run.runId)}
                  </Link>
                  <span className="text-muted">
                    , {run.profileName}, <Time value={run.runCreatedAt} />
                  </span>
                  {run.rejectionReasons.length > 0 && (
                    <p className="text-muted">{run.rejectionReasons.join("; ")}</p>
                  )}
                  {run.notificationNote && <p className="text-muted">Alert: {run.notificationNote}</p>}
                </div>
                <StatusBadge status={run.processingStatus} />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel id="alerts" title="Alerts" description="Sent means the mail server accepted the e-mail.">
          {notifications.length === 0 ? (
            <EmptyState title="No alert for this job" />
          ) : (
            <ul className="divide-y divide-line">
              {notifications.map((n) => (
                <li key={n.id} className="flex flex-col gap-1 px-4 py-3 text-[13px]">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-medium">To {n.recipientLabel}</span>
                    <StatusBadge status={n.status} />
                  </div>
                  <p className="text-muted">
                    {n.attempts} {n.attempts === 1 ? "attempt" : "attempts"}
                    {n.sentAt && (
                      <>
                        , sent <Time value={n.sentAt} />
                      </>
                    )}
                    {n.deliveredAt && (
                      <>
                        , delivered <Time value={n.deliveredAt} />
                      </>
                    )}
                    {n.readAt && (
                      <>
                        , read <Time value={n.readAt} />
                      </>
                    )}
                  </p>
                  {n.lastError && <p className="text-danger">{n.lastError}</p>}
                  <ol className="mt-1 list-decimal pl-5 text-muted">
                    {attempts
                      .filter((a) => a.notificationId === n.id)
                      .map((a) => (
                        <li key={a.attemptNumber}>
                          <Time value={a.startedAt} /> {a.manual ? "manual retry" : "automatic"}:{" "}
                          {OUTCOME_LABEL[a.outcome] ?? a.outcome.replace(/_/g, " ").toLowerCase()}
                          {a.httpStatus ? ` (HTTP ${a.httpStatus})` : ""}
                          {a.error ? `, ${a.error}` : ""}
                        </li>
                      ))}
                  </ol>
                  <details>
                    <summary className="cursor-pointer text-muted hover:text-ink">Message preview</summary>
                    <p className="mt-1 whitespace-pre-wrap">{n.messagePreview}</p>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
