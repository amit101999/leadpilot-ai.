import { toCents } from "@/lib/money/decimal";
import type { NormalizedClient, NormalizedJob } from "@/modules/job-sources/types";

/** The client facts the Potential score reads (a stored client row or a freshly imported one). */
export type PotentialClient = Pick<
  NormalizedClient,
  "paymentVerified" | "hireRatePercent" | "totalSpent" | "rating"
>;
import type { ProfileConfig } from "@/modules/profiles/config-schema";

/**
 * How winnable and worthwhile a job is, 0-100, from facts only (no AI): four signals of 0-25 points each.
 * Unknown data scores in the middle, so a job is never sunk by what the source did not say.
 */
export interface PotentialScore {
  score: number;
  signals: {
    competition: number;
    client: number;
    budget: number;
    longTerm: number;
  };
  /** Short, human-readable reasons, strongest first; shown on the lead and in the alert. */
  reasons: string[];
}

const MAX = 25;
const clamp = (n: number) => Math.max(0, Math.min(MAX, Math.round(n)));

/** Points for Upwork's proposal bands: fewer applicants, better odds. */
const PROPOSAL_POINTS: Record<string, number> = {
  "less than 5": 25,
  "5 to 10": 20,
  "10 to 15": 15,
  "15 to 20": 10,
  "20 to 50": 5,
  "50+": 0,
};

export function computePotential(
  job: NormalizedJob,
  client: PotentialClient | null,
  config: Pick<ProfileConfig, "budget">,
  now: Date = new Date(),
): PotentialScore {
  const reasons: Array<{ points: number; text: string }> = [];
  const competition = scoreCompetition(job, now, reasons);
  const clientPoints = scoreClient(job, client, reasons);
  const budget = scoreBudget(job, config, clientPoints, reasons);
  const longTerm = scoreLongTerm(job, reasons);
  return {
    score: competition + clientPoints + budget + longTerm,
    signals: { competition, client: clientPoints, budget, longTerm },
    reasons: reasons.sort((a, b) => b.points - a.points).map((r) => r.text),
  };
}

function scoreCompetition(job: NormalizedJob, now: Date, reasons: Array<{ points: number; text: string }>) {
  const { proposalsTier, interviewing, invitesSent } = job.posting;
  const tierPoints = proposalsTier ? PROPOSAL_POINTS[proposalsTier.trim().toLowerCase()] : undefined;
  let points = tierPoints ?? 12;
  if (tierPoints !== undefined && tierPoints >= 15)
    reasons.push({ points: tierPoints, text: `Few proposals (${proposalsTier})` });
  if (tierPoints !== undefined && tierPoints <= 5)
    reasons.push({ points: -tierPoints, text: `Crowded (${proposalsTier} proposals)` });
  if (interviewing !== null && interviewing > 3) points -= 5;
  if (invitesSent !== null && invitesSent > 10) points -= 5;
  const ageHours = job.postedAt ? (now.getTime() - job.postedAt.getTime()) / 3_600_000 : null;
  if (ageHours !== null && ageHours >= 0 && ageHours <= 6) {
    points += 5;
    reasons.push({ points: 5, text: "Posted in the last 6 hours" });
  }
  return clamp(points);
}

function scoreClient(
  job: NormalizedJob,
  client: PotentialClient | null,
  reasons: Array<{ points: number; text: string }>,
) {
  const verified = client?.paymentVerified ?? job.paymentVerified;
  const hireRate = client?.hireRatePercent ?? null;
  const spent = toCents(client?.totalSpent ?? job.clientTotalSpent ?? "");
  const rating = Number.parseFloat(client?.rating ?? job.clientRating ?? "");
  let points = 0;
  points += verified === true ? 8 : verified === null ? 3 : 0;
  points += hireRate === null ? 2 : hireRate >= 70 ? 7 : hireRate >= 50 ? 5 : 0;
  points += spent === null ? 1 : spent >= 1_000_000n ? 6 : spent >= 100_000n ? 4 : spent > 0n ? 2 : 0;
  points += Number.isNaN(rating) ? 1 : rating >= 4.5 ? 4 : rating >= 4 ? 2 : 0;
  if (hireRate !== null && hireRate >= 70)
    reasons.push({ points: 7, text: `Client hires ${hireRate}% of the time` });
  if (spent !== null && spent >= 1_000_000n) reasons.push({ points: 6, text: "Client has spent $10k+" });
  if (verified === false) reasons.push({ points: -8, text: "Payment not verified" });
  return clamp(points);
}

function scoreBudget(
  job: NormalizedJob,
  config: Pick<ProfileConfig, "budget">,
  clientPoints: number,
  reasons: Array<{ points: number; text: string }>,
) {
  const fixedMin = config.budget.fixedMin ? toCents(config.budget.fixedMin) : null;
  const hourlyMin = config.budget.hourlyMin ? toCents(config.budget.hourlyMin) : null;
  const offered =
    job.budgetType === "FIXED"
      ? { value: toCents(job.budgetAmount ?? ""), min: fixedMin, label: "budget" }
      : { value: toCents(job.hourlyMax ?? job.hourlyMin ?? ""), min: hourlyMin, label: "hourly rate" };
  if (offered.value === null) {
    // No budget stated: a strong client still makes it worth a look.
    return clientPoints >= 15 ? 15 : 8;
  }
  if (offered.min === null) return 20;
  if (offered.value >= offered.min) {
    reasons.push({ points: 25, text: `The ${offered.label} fits your minimum` });
    return 25;
  }
  if (offered.value * 2n >= offered.min) return 12;
  reasons.push({ points: -25, text: `The ${offered.label} is well below your minimum` });
  return 0;
}

function scoreLongTerm(job: NormalizedJob, reasons: Array<{ points: number; text: string }>) {
  const duration = (job.posting.duration ?? "").toLowerCase();
  const workload = (job.posting.workload ?? "").toLowerCase();
  let points = duration.includes("more than 6")
    ? 25
    : duration.includes("3 to 6")
      ? 20
      : duration.includes("1 to 3")
        ? 15
        : duration.includes("less than 1")
          ? 5
          : 10;
  if (workload.includes("full") || workload.includes("30+") || workload.includes("more than 30")) points += 5;
  if (points >= 20) reasons.push({ points, text: `Long-term work (${job.posting.duration ?? "ongoing"})` });
  return clamp(points);
}
