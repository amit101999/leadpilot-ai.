/**
 * Shapes the agent's raw Upwork MCP results into small import requests for LeadPilot.
 *
 * LeadPilot's import contract (src/modules/job-sources/upwork-import/normalize.ts) reads only a few
 * fields; raw `find_jobs get` responses also carry review comments, work history and other bulk.
 * Keeping only the read fields here keeps each request well under the server's 256 KB body limit.
 */

/** Same cap the server applies to descriptions. */
const MAX_DESCRIPTION = 20_000;
/** Below the server's 256 KB request limit, leaving room for the JSON envelope. */
export const MAX_REQUEST_BYTES = 200_000;
export const MAX_JOBS_PER_REQUEST = 100;

/** Copies only the listed keys (nested objects described by a sub-shape), dropping everything else. */
function pick(value, shape) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const out = {};
  for (const [key, sub] of Object.entries(shape)) {
    if (!(key in value)) continue;
    out[key] = sub === true ? value[key] : pick(value[key], sub);
  }
  return out;
}

const truncate = (text) => (typeof text === "string" ? text.slice(0, MAX_DESCRIPTION) : text);

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
  proposals_tier: true,
  freelancers_to_hire: true,
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
    contracts_total: true,
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
      classification: { category: { preferredLabel: true } },
      contractTerms: {
        contractType: true,
        fixedPriceContractTerms: { amount: { currency: true, rawValue: true } },
      },
      activityStat: { jobActivity: { totalHired: true, invitesSent: true } },
      workFlowState: { status: true },
      clientCompanyPublic: { country: { name: true } },
    },
  },
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
