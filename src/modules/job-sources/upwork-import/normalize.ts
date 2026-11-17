import { z } from "zod";
import { isDecimalString } from "@/lib/money/decimal";
import {
  EMPTY_POSTING,
  type ClientContract,
  type ClientOpenJob,
  type ClientReview,
  type JobPosting,
  type NormalizedClient,
  type NormalizedJob,
} from "@/modules/job-sources/types";

/**
 * Contract for jobs sent by the import agent: an item from the Upwork MCP `find_jobs` search /
 * smart_search result, optionally with the raw `find_jobs get` response attached as `details`.
 * Unknown keys are stripped (zod default), so anything not listed here (e.g. signed attachment
 * links) is never stored. Third-party text in reviews and work history is clipped, stored for the
 * UI and never sent to the AI model.
 */
const shortText = (max: number) => z.string().trim().max(max);
/** Optional third-party text: clipped rather than rejected, so one long entry never drops a job. */
const clipped = (max: number) => z.string().transform((s) => s.trim().slice(0, max));
const amount = z.union([z.string().max(64), z.number()]).nullish();
const count = z.number().int().min(0).max(10_000_000).nullish();
const score = z.number().min(0).max(5).nullish();
/** Lists are capped by keeping the first entries (the sources order them newest first). */
const firstFive = <T extends z.ZodType>(item: T) => z.array(item).transform((list) => list.slice(0, 5));

export const LIST_CAP = 5;
export const MAX_REVIEW_COMMENT = 2_000;

const contractSchema = z
  .object({
    title: clipped(300),
    type: shortText(20).nullish(),
    status: shortText(40).nullish(),
    started: shortText(40).nullish(),
    ended: shortText(40).nullish(),
    feedback_to_client_score: score,
  })
  .partial()
  .required({ title: true });

const detailsSchema = z
  .object({
    client_record: z
      .object({
        contracts_active: count,
        contracts_total: count,
        jobs_with_hires: count,
        hire_rate_percent: z.number().min(0).max(100).nullish(),
        hours_total: z.number().min(0).max(100_000_000).nullish(),
        jobs_posted: count,
        open_jobs: count,
        feedback_count: count,
        feedback_score: score,
        spend_total: amount,
      })
      .partial(),
    data: z
      .object({
        marketplaceJobPosting: z
          .object({
            content: z.object({ title: shortText(500), description: shortText(60_000) }).partial(),
            classification: z
              .object({
                category: z.object({ preferredLabel: shortText(120) }).partial(),
                subCategory: z.object({ preferredLabel: shortText(120) }).partial(),
              })
              .partial(),
            contractTerms: z
              .object({
                contractType: shortText(20),
                experienceLevel: shortText(40),
                personsToHire: count,
                fixedPriceContractTerms: z
                  .object({ amount: z.object({ currency: shortText(3), rawValue: amount }).partial() })
                  .partial(),
                hourlyContractTerms: z
                  .object({ engagementType: shortText(40), hourlyBudgetMin: amount, hourlyBudgetMax: amount })
                  .partial(),
              })
              .partial(),
            activityStat: z
              .object({
                jobActivity: z
                  .object({
                    totalHired: count,
                    invitesSent: count,
                    totalInvitedToInterview: count,
                    totalOffered: count,
                  })
                  .partial(),
              })
              .partial(),
            workFlowState: z.object({ status: shortText(40) }).partial(),
            clientCompanyPublic: z
              .object({
                id: z.union([
                  z
                    .string()
                    .trim()
                    .regex(/^[A-Za-z0-9~_-]{1,64}$/),
                  z.number().int().min(0),
                ]),
                country: z.object({ name: shortText(80) }).partial(),
                state: shortText(80).nullish(),
                timezone: shortText(64).nullish(),
              })
              .partial(),
          })
          .partial(),
      })
      .partial(),
    client_feedback: z
      .object({
        reviews: firstFive(
          z.object({
            title: clipped(300).nullish(),
            comment: clipped(MAX_REVIEW_COMMENT).nullish(),
            score,
            ended: shortText(40).nullish(),
          }),
        ),
      })
      .partial(),
    client_work_history: z
      .object({ open: firstFive(contractSchema), closed: firstFive(contractSchema) })
      .partial(),
    client_open_jobs: firstFive(
      z.object({
        id: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9~]{1,64}$/),
        title: clipped(300),
        job_type: shortText(20).nullish(),
        url: shortText(2048).nullish(),
      }),
    ),
    preferred_qualifications: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    connects_cost: count,
  })
  .partial();

export const upworkMcpJobSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9~]{1,64}$/, "Unexpected Upwork job id"),
  title: shortText(500).min(1),
  description: shortText(60_000).nullish(),
  description_snippet: shortText(2_000).nullish(),
  url: shortText(2048).nullish(),
  job_type: shortText(20).nullish(),
  budget: amount,
  skills: z.array(shortText(100)).max(50).nullish(),
  experience_level: shortText(40).nullish(),
  duration: shortText(60).nullish(),
  engagement: shortText(40).nullish(),
  featured: z.boolean().nullish(),
  proposals_tier: shortText(40).nullish(),
  freelancers_to_hire: count,
  job_activity: z
    .object({ invites_sent: count, invited_to_interview: count, total_offered: count, total_hired: count })
    .partial()
    .nullish(),
  created_date: shortText(40).nullish(),
  published_date: shortText(40).nullish(),
  client: z
    .object({
      country: shortText(80).nullish(),
      rating: score,
      total_posted_jobs: count,
      total_reviews: count,
      total_spent: amount,
      verification_status: shortText(40).nullish(),
    })
    .partial()
    .nullish(),
  details: detailsSchema.nullish(),
});
type UpworkMcpJob = z.infer<typeof upworkMcpJobSchema>;
type UpworkDetails = NonNullable<UpworkMcpJob["details"]>;

/** Imported jobs keep the real platform's source id, so the dedup key matches a future official API adapter. */
export const UPWORK_SOURCE = "upwork";

const UNTRUSTED_WRAPPER = /<\/?untrusted_participant_content>/gi;
const UPWORK_HOSTS = new Set(["www.upwork.com", "upwork.com"]);

export function cleanText(text: string | null | undefined): string {
  return (text ?? "").replace(UNTRUSTED_WRAPPER, "").trim();
}

/** Upwork links without tracking parameters; anything not an https Upwork link becomes null. */
export function canonicalUpworkUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !UPWORK_HOSTS.has(url.hostname.toLowerCase())) return null;
    return `https://www.upwork.com${url.pathname}`;
  } catch {
    return null;
  }
}

/** "$23,575.22" / 35 / "35.0" -> "23575.22" / "35.00" / "35.00"; anything else -> null. */
export function toDecimal(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" ? String(value) : value.replace(/[$,\s]/g, "").replace(/^USD/i, "");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const normalized = `${whole}.${(fraction + "00").slice(0, 2)}`;
  return isDecimalString(normalized) ? normalized : null;
}

/** Hourly budgets: "15.00-30.00", "$15 – $30" (Upwork uses an en dash), "15+" (lower bound only). */
function hourlyRange(value: string | number | null | undefined): { min: string | null; max: string | null } {
  if (value === null || value === undefined) return { min: null, max: null };
  const text = String(value).replace(/[$/hr\s]/gi, "");
  const range = text.match(/^([\d.,]+)[-–—]([\d.,]+)$/);
  if (range) return { min: toDecimal(range[1]), max: toDecimal(range[2]) };
  return { min: toDecimal(text.replace(/\+$/, "")), max: null };
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "PART_TIME" / "part_time" / "Part time" -> "Part time". */
function label(value: string | null | undefined): string | null {
  if (!value) return null;
  const words = value.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : null;
}

/** A 0 rating with no reviews means "not rated yet", not a bad rating. */
function ratingOf(value: number | null | undefined, reviews: number | null | undefined): string | null {
  return value && (reviews ?? 1) > 0 ? value.toFixed(2) : null;
}

function toContract(c: z.infer<typeof contractSchema>): ClientContract {
  return {
    title: cleanText(c.title),
    type: c.type ?? null,
    status: c.status ?? null,
    startedAt: c.started ?? null,
    endedAt: c.ended ?? null,
    feedbackToClient: c.feedback_to_client_score ?? null,
  };
}

/** The client record, only when the detail call identified the client company. */
function normalizeClient(job: UpworkMcpJob, details: UpworkDetails): NormalizedClient | null {
  const company = details.data?.marketplaceJobPosting?.clientCompanyPublic;
  if (company?.id === undefined) return null;
  const record = details.client_record ?? {};
  const search = job.client ?? {};
  const verification = search.verification_status?.toUpperCase();
  const reviewsCount = record.feedback_count ?? search.total_reviews ?? null;
  const reviews: ClientReview[] = (details.client_feedback?.reviews ?? [])
    .map((r) => ({
      title: cleanText(r.title),
      comment: cleanText(r.comment),
      score: r.score ?? null,
      endedAt: r.ended ?? null,
    }))
    .filter((r) => r.title || r.comment);
  const openJobs: ClientOpenJob[] = (details.client_open_jobs ?? [])
    .filter((o) => o.id !== job.id)
    .map((o) => ({
      sourceJobId: o.id,
      title: cleanText(o.title),
      jobType: o.job_type ?? null,
      url: canonicalUpworkUrl(o.url),
    }));
  return {
    sourceClientId: String(company.id),
    country: company.country?.name ?? search.country ?? null,
    state: company.state ?? null,
    timezone: company.timezone ?? null,
    paymentVerified: verification ? verification === "VERIFIED" : null,
    rating: ratingOf(record.feedback_score ?? search.rating, reviewsCount),
    reviewsCount,
    totalSpent: toDecimal(record.spend_total ?? search.total_spent),
    totalHires: record.contracts_total ?? null,
    jobsWithHires: record.jobs_with_hires ?? null,
    activeContracts: record.contracts_active ?? null,
    hoursTotal: toDecimal(record.hours_total),
    jobsPosted: record.jobs_posted ?? search.total_posted_jobs ?? null,
    openJobs: record.open_jobs ?? null,
    hireRatePercent: record.hire_rate_percent ?? null,
    recentReviews: reviews,
    workHistory: {
      open: (details.client_work_history?.open ?? []).map(toContract),
      closed: (details.client_work_history?.closed ?? []).map(toContract),
    },
    otherOpenJobs: openJobs,
  };
}

function normalizePosting(job: UpworkMcpJob, fetchedAt: Date): JobPosting {
  const details = job.details;
  const posting = details?.data?.marketplaceJobPosting;
  const terms = posting?.contractTerms;
  const funnel = posting?.activityStat?.jobActivity;
  const searchFunnel = job.job_activity ?? {};
  return {
    subcategory: posting?.classification?.subCategory?.preferredLabel ?? null,
    experienceLevel: label(terms?.experienceLevel ?? job.experience_level),
    duration: job.duration ?? null,
    workload: label(terms?.hourlyContractTerms?.engagementType ?? job.engagement),
    personsToHire: terms?.personsToHire ?? job.freelancers_to_hire ?? null,
    proposalsTier: job.proposals_tier ?? null,
    connectsCost: details?.connects_cost ?? null,
    featured: job.featured ?? null,
    invitesSent: funnel?.invitesSent ?? searchFunnel.invites_sent ?? null,
    interviewing: funnel?.totalInvitedToInterview ?? searchFunnel.invited_to_interview ?? null,
    offersMade: funnel?.totalOffered ?? searchFunnel.total_offered ?? null,
    hiresMade: funnel?.totalHired ?? searchFunnel.total_hired ?? null,
    workflowStatus: posting?.workFlowState?.status ?? null,
    preferredQualifications: details?.preferred_qualifications ?? null,
    detailsFetchedAt: details ? fetchedAt : null,
  };
}

/** Maps one validated MCP job (plus optional details) to the provider-neutral job record. */
export function normalizeUpworkMcpJob(job: UpworkMcpJob, now: Date = new Date()): NormalizedJob {
  const posting = job.details?.data?.marketplaceJobPosting;
  const record = job.details?.client_record;
  const contractType = (posting?.contractTerms?.contractType ?? job.job_type ?? "").toUpperCase();
  // Tolerant of spellings such as "FIXED_PRICE", "Fixed price" or "HOURLY_RATE".
  const budgetType = contractType.includes("FIXED")
    ? "FIXED"
    : contractType.includes("HOURLY")
      ? "HOURLY"
      : "UNKNOWN";
  const fixedAmount = posting?.contractTerms?.fixedPriceContractTerms?.amount;
  const hourlyTerms = posting?.contractTerms?.hourlyContractTerms;
  const searchHourly = budgetType === "HOURLY" ? hourlyRange(job.budget) : { min: null, max: null };
  const client = job.client ?? {};
  const verification = client.verification_status?.toUpperCase();
  const reviews = record?.feedback_count ?? client.total_reviews;

  return {
    source: UPWORK_SOURCE,
    sourceJobId: job.id,
    title: cleanText(job.title).slice(0, 500),
    // Full text from job details when fetched; search results may carry only a snippet.
    description: cleanText(posting?.content?.description ?? job.description ?? job.description_snippet).slice(
      0,
      20_000,
    ),
    jobUrl: canonicalUpworkUrl(job.url),
    budgetType,
    budgetAmount: budgetType === "FIXED" ? toDecimal(fixedAmount?.rawValue ?? job.budget) : null,
    budgetMax: null,
    hourlyMin: budgetType === "HOURLY" ? (toDecimal(hourlyTerms?.hourlyBudgetMin) ?? searchHourly.min) : null,
    hourlyMax: budgetType === "HOURLY" ? (toDecimal(hourlyTerms?.hourlyBudgetMax) ?? searchHourly.max) : null,
    // Upwork marketplace budgets are USD; search results carry no currency field.
    currency: (fixedAmount?.currency ?? "USD").toUpperCase(),
    paymentVerified: verification ? verification === "VERIFIED" : null,
    // The detail call's figure is read live, so it wins over the search row's.
    clientRating: ratingOf(record?.feedback_score ?? client.rating, reviews),
    clientHires: record?.contracts_total ?? record?.jobs_with_hires ?? null,
    clientTotalSpent: toDecimal(record?.spend_total ?? client.total_spent),
    clientCountry: posting?.clientCompanyPublic?.country?.name ?? client.country ?? null,
    skills: (job.skills ?? []).map(cleanText).filter(Boolean),
    category: posting?.classification?.category?.preferredLabel ?? null,
    postedAt: parseDate(job.published_date ?? job.created_date),
    posting: normalizePosting(job, now),
    client: job.details ? normalizeClient(job, job.details) : null,
    sourceMetadata: { origin: "upwork-mcp", detailsFetched: Boolean(job.details) },
  };
}

const nullableText = z.string().nullable();
const nullableInt = z.number().int().nullable();

const postingSchema = z.object({
  subcategory: nullableText,
  experienceLevel: nullableText,
  duration: nullableText,
  workload: nullableText,
  personsToHire: nullableInt,
  proposalsTier: nullableText,
  connectsCost: nullableInt,
  featured: z.boolean().nullable(),
  invitesSent: nullableInt,
  interviewing: nullableInt,
  offersMade: nullableInt,
  hiresMade: nullableInt,
  workflowStatus: nullableText,
  preferredQualifications: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .nullable(),
  detailsFetchedAt: z.coerce.date().nullable(),
});

const storedContract = z.object({
  title: z.string(),
  type: nullableText,
  status: nullableText,
  startedAt: nullableText,
  endedAt: nullableText,
  feedbackToClient: z.number().nullable(),
});

/** A NormalizedClient as stored (staged_jobs.payload, clients jsonb lists). */
export const storedClientSchema = z.object({
  sourceClientId: z.string().min(1).max(64),
  country: nullableText,
  state: nullableText,
  timezone: nullableText,
  paymentVerified: z.boolean().nullable(),
  rating: nullableText,
  reviewsCount: nullableInt,
  totalSpent: nullableText,
  totalHires: nullableInt,
  jobsWithHires: nullableInt,
  activeContracts: nullableInt,
  hoursTotal: nullableText,
  jobsPosted: nullableInt,
  openJobs: nullableInt,
  hireRatePercent: z.number().nullable(),
  recentReviews: z
    .array(
      z.object({
        title: z.string(),
        comment: z.string(),
        score: z.number().nullable(),
        endedAt: nullableText,
      }),
    )
    .max(LIST_CAP),
  workHistory: z.object({
    open: z.array(storedContract).max(LIST_CAP),
    closed: z.array(storedContract).max(LIST_CAP),
  }),
  otherOpenJobs: z
    .array(z.object({ sourceJobId: z.string(), title: z.string(), jobType: nullableText, url: nullableText }))
    .max(LIST_CAP),
});

/** A NormalizedJob as stored in staged_jobs.payload (JSON: dates as strings). */
const stagedJobSchema = z.object({
  source: z.string().min(1).max(40),
  sourceJobId: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  description: z.string().max(20_000),
  jobUrl: z.string().max(2048).nullable(),
  budgetType: z.enum(["FIXED", "HOURLY", "UNKNOWN"]),
  budgetAmount: z.string().nullable(),
  budgetMax: z.string().nullable(),
  hourlyMin: z.string().nullable(),
  hourlyMax: z.string().nullable(),
  currency: z.string().nullable(),
  paymentVerified: z.boolean().nullable(),
  clientRating: z.string().nullable(),
  clientHires: z.number().int().nullable(),
  clientTotalSpent: z.string().nullable(),
  clientCountry: z.string().nullable(),
  skills: z.array(z.string()),
  category: z.string().nullable(),
  postedAt: z.coerce.date().nullable(),
  // Payloads queued before these fields existed still load (as "search data only").
  posting: postingSchema.default({ ...EMPTY_POSTING }),
  client: storedClientSchema.nullable().default(null),
  sourceMetadata: z.record(z.string(), z.unknown()),
});

export function parseStagedJob(payload: unknown): NormalizedJob | null {
  const parsed = stagedJobSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
