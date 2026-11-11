import { z } from "zod";
import { isDecimalString } from "@/lib/money/decimal";
import type { NormalizedJob } from "@/modules/job-sources/types";

/**
 * Contract for jobs sent by the import agent: an item from the Upwork MCP `find_jobs` search /
 * smart_search result, optionally with the raw `find_jobs get` response attached as `details`.
 * Unknown keys are stripped (zod default), so review comments, work history and other free text
 * the agent may pass along are never stored.
 */
const shortText = (max: number) => z.string().trim().max(max);
const amount = z.union([z.string().max(64), z.number()]).nullish();
const count = z.number().int().min(0).max(10_000_000).nullish();

const detailsSchema = z
  .object({
    client_record: z
      .object({
        contracts_total: count,
        jobs_with_hires: count,
        hire_rate_percent: z.number().min(0).max(100).nullish(),
        jobs_posted: count,
        open_jobs: count,
        feedback_count: count,
        feedback_score: z.number().min(0).max(5).nullish(),
        spend_total: amount,
      })
      .partial(),
    data: z
      .object({
        marketplaceJobPosting: z
          .object({
            content: z.object({ title: shortText(500), description: shortText(60_000) }).partial(),
            classification: z
              .object({ category: z.object({ preferredLabel: shortText(120) }).partial() })
              .partial(),
            contractTerms: z
              .object({
                contractType: shortText(20),
                fixedPriceContractTerms: z
                  .object({ amount: z.object({ currency: shortText(3), rawValue: amount }).partial() })
                  .partial(),
              })
              .partial(),
            activityStat: z
              .object({ jobActivity: z.object({ totalHired: count, invitesSent: count }).partial() })
              .partial(),
            workFlowState: z.object({ status: shortText(40) }).partial(),
            clientCompanyPublic: z.object({ country: z.object({ name: shortText(80) }).partial() }).partial(),
          })
          .partial(),
      })
      .partial(),
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
  proposals_tier: shortText(40).nullish(),
  freelancers_to_hire: count,
  created_date: shortText(40).nullish(),
  published_date: shortText(40).nullish(),
  client: z
    .object({
      country: shortText(80).nullish(),
      rating: z.number().min(0).max(5).nullish(),
      total_posted_jobs: count,
      total_reviews: count,
      total_spent: amount,
      verification_status: shortText(40).nullish(),
    })
    .partial()
    .nullish(),
  details: detailsSchema.nullish(),
});
export type UpworkMcpJob = z.infer<typeof upworkMcpJobSchema>;

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

/** Hourly budgets: "15.00-30.00", "$15 - $30", "15+" (lower bound only). */
function hourlyRange(value: string | number | null | undefined): { min: string | null; max: string | null } {
  if (value === null || value === undefined) return { min: null, max: null };
  const text = String(value).replace(/[$/hr\s]/gi, "");
  const range = text.match(/^([\d.,]+)-([\d.,]+)$/);
  if (range) return { min: toDecimal(range[1]), max: toDecimal(range[2]) };
  return { min: toDecimal(text.replace(/\+$/, "")), max: null };
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Maps one validated MCP job (plus optional details) to the provider-neutral job record. */
export function normalizeUpworkMcpJob(job: UpworkMcpJob): NormalizedJob {
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
  const hourly = budgetType === "HOURLY" ? hourlyRange(job.budget) : { min: null, max: null };
  const client = job.client ?? {};
  const verification = client.verification_status?.toUpperCase();
  // A 0 rating with no reviews means "not rated yet", not a bad rating.
  const rating = client.rating && (client.total_reviews ?? 1) > 0 ? client.rating.toFixed(2) : null;

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
    hourlyMin: hourly.min,
    hourlyMax: hourly.max,
    // Upwork marketplace budgets are USD; search results carry no currency field.
    currency: (fixedAmount?.currency ?? "USD").toUpperCase(),
    paymentVerified: verification ? verification === "VERIFIED" : null,
    clientRating: rating,
    clientHires: record?.contracts_total ?? record?.jobs_with_hires ?? null,
    clientTotalSpent: toDecimal(record?.spend_total ?? client.total_spent),
    clientCountry: posting?.clientCompanyPublic?.country?.name ?? client.country ?? null,
    skills: (job.skills ?? []).map(cleanText).filter(Boolean),
    category: posting?.classification?.category?.preferredLabel ?? null,
    postedAt: parseDate(job.published_date ?? job.created_date),
    sourceMetadata: {
      origin: "upwork-mcp",
      detailsFetched: Boolean(job.details),
      experienceLevel: job.experience_level ?? null,
      duration: job.duration ?? null,
      proposalsTier: job.proposals_tier ?? null,
      freelancersToHire: job.freelancers_to_hire ?? null,
      client: {
        totalPostedJobs: record?.jobs_posted ?? client.total_posted_jobs ?? null,
        totalReviews: record?.feedback_count ?? client.total_reviews ?? null,
        hireRatePercent: record?.hire_rate_percent ?? null,
        openJobs: record?.open_jobs ?? null,
        jobsWithHires: record?.jobs_with_hires ?? null,
      },
      job: {
        totalHired: posting?.activityStat?.jobActivity?.totalHired ?? null,
        invitesSent: posting?.activityStat?.jobActivity?.invitesSent ?? null,
        workflowStatus: posting?.workFlowState?.status ?? null,
        connectsCost: job.details?.connects_cost ?? null,
      },
      preferredQualifications: job.details?.preferred_qualifications ?? null,
    },
  };
}

/** A NormalizedJob as stored in staged_jobs.payload (JSON: dates as strings). */
export const stagedJobSchema = z.object({
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
  sourceMetadata: z.record(z.string(), z.unknown()),
});

export function parseStagedJob(payload: unknown): NormalizedJob | null {
  const parsed = stagedJobSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
