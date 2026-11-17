/**
 * Shapes the agent's raw Upwork MCP results into small import requests for LeadPilot.
 *
 * LeadPilot's import contract (src/modules/job-sources/upwork-import/normalize.ts) reads only the
 * fields listed here. Everything else in a raw `find_jobs get` response is dropped, notably
 * `attachments`, whose links carry temporary signed S3 credentials and must never be stored.
 * Lists and free text are capped so each request stays well under the server's 256 KB body limit.
 */

/** Same cap the server applies to descriptions. */
const MAX_DESCRIPTION = 20_000;
/** Same caps the server applies to client reviews and history lists. */
const MAX_COMMENT = 2_000;
const MAX_LIST = 5;
/** Below the server's 256 KB request limit, leaving room for the JSON envelope. */
export const MAX_REQUEST_BYTES = 200_000;
export const MAX_JOBS_PER_REQUEST = 100;

/**
 * Copies only the listed keys, dropping everything else. A nested object is described by a sub-shape;
 * a list of objects by `[subShape]` (applied to each item, at most MAX_LIST items).
 */
function pick(value, shape) {
  if (Array.isArray(shape)) {
    return Array.isArray(value) ? value.slice(0, MAX_LIST).map((item) => pick(item, shape[0])) : undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const out = {};
  for (const [key, sub] of Object.entries(shape)) {
    if (!(key in value)) continue;
    out[key] = sub === true ? value[key] : pick(value[key], sub);
  }
  return out;
}

const truncate = (text, max = MAX_DESCRIPTION) => (typeof text === "string" ? text.slice(0, max) : text);

const SEARCH_ITEM = {
  id: true,
  title: true,
  description: true,
  description_snippet: true,
  url: true,
  job_type: true,
  budget: true,
  skills: true,
  experience_level: true,
  duration: true,
  engagement: true,
  featured: true,
  proposals_tier: true,
  freelancers_to_hire: true,
  job_activity: { invites_sent: true, invited_to_interview: true, total_offered: true, total_hired: true },
  created_date: true,
  published_date: true,
  client: {
    country: true,
    rating: true,
    total_posted_jobs: true,
    total_reviews: true,
    total_spent: true,
    verification_status: true,
  },
};

const DETAILS = {
  client_record: {
    contracts_active: true,
    contracts_total: true,
    hours_total: true,
    jobs_with_hires: true,
    hire_rate_percent: true,
    jobs_posted: true,
    open_jobs: true,
    feedback_count: true,
    feedback_score: true,
    spend_total: true,
  },
  data: {
    marketplaceJobPosting: {
      content: { title: true, description: true },
      classification: { category: { preferredLabel: true }, subCategory: { preferredLabel: true } },
      contractTerms: {
        contractType: true,
        experienceLevel: true,
        personsToHire: true,
        fixedPriceContractTerms: { amount: { currency: true, rawValue: true } },
        hourlyContractTerms: { engagementType: true, hourlyBudgetMin: true, hourlyBudgetMax: true },
      },
      activityStat: {
        jobActivity: {
          totalHired: true,
          invitesSent: true,
          totalInvitedToInterview: true,
          totalOffered: true,
        },
      },
      workFlowState: { status: true },
      clientCompanyPublic: { id: true, country: { name: true }, state: true, timezone: true },
    },
  },
  client_feedback: { reviews: [{ title: true, comment: true, score: true, ended: true }] },
  client_work_history: {
    open: [
      { title: true, type: true, status: true, started: true, ended: true, feedback_to_client_score: true },
    ],
    closed: [
      { title: true, type: true, status: true, started: true, ended: true, feedback_to_client_score: true },
    ],
  },
  client_open_jobs: [{ id: true, title: true, job_type: true, url: true }],
  preferred_qualifications: true,
  connects_cost: true,
};

/** One job as sent to LeadPilot: the search item's known fields plus slimmed details, if fetched. */
export function slimJob(job, details) {
  const slim = pick(job, SEARCH_ITEM);
  if ("description" in slim) slim.description = truncate(slim.description);
  if (details && typeof details === "object") {
    const d = pick(details, DETAILS);
    const content = d.data?.marketplaceJobPosting?.content;
    if (content) content.description = truncate(content.description);
    for (const review of d.client_feedback?.reviews ?? [])
      review.comment = truncate(review.comment, MAX_COMMENT);
    slim.details = d;
  }
  return slim;
}

/** Splits jobs into requests of at most `maxBytes` (JSON size) and `maxCount` jobs each. */
export function chunkJobs(jobs, maxBytes = MAX_REQUEST_BYTES, maxCount = MAX_JOBS_PER_REQUEST) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const job of jobs) {
    const bytes = Buffer.byteLength(JSON.stringify(job), "utf8") + 1;
    if (current.length > 0 && (size + bytes > maxBytes || current.length >= maxCount)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(job);
    size += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
