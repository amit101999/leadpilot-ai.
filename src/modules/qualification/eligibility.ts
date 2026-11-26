import type { AiOutput, RiskFlag } from "@/modules/ai/output-schema";
import type { ProfileConfig } from "@/modules/profiles/config-schema";
import type { QualificationDecision } from "@/types/domain";
import type { HardCheckSummary } from "./hard-filters";

export interface EligibilityInput {
  hardChecks: HardCheckSummary;
  /** null when the AI output never passed validation. */
  ai: AiOutput | null;
  /** The lead score (AI fit blended with Potential, plus any priority-country bonus); null without valid AI output. */
  authoritativeScore: number | null;
  alreadyNotified: boolean;
}

/** Hot: alerted at once. Warm: kept as a lead, not alerted. Cold: below the Warm bar (rejected). */
export type LeadTier = "HOT" | "WARM" | "COLD";

export interface EligibilityDecision {
  decision: QualificationDecision;
  /** Set once the job has a lead score; null when it never got one. */
  tier: LeadTier | null;
  reasons: string[];
  blockingRiskFlags: RiskFlag[];
}

const SEVERITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3 } as const;
/** Minimum severity rank that blocks qualification for each sensitivity level. */
const BLOCKING_SEVERITY = { LOW: Number.POSITIVE_INFINITY, MEDIUM: 3, HIGH: 2 } as const;

/** The lowest lead score still kept as a (Warm) lead. */
export function warmThreshold(config: Pick<ProfileConfig, "ai" | "leads">): number {
  return Math.max(0, config.ai.minScore - config.leads.warmBelowHot);
}

/**
 * Final deterministic check (pipeline stage 7). AI can only lower a job's
 * standing: hard-filter results are re-asserted here, so no model output can
 * bypass a mandatory business rule. Qualified jobs are Hot (score >= ai.minScore, alerted) or Warm (score >= the
 * Warm bar, kept as a lead without an alert).
 */
export function decideEligibility(input: EligibilityInput, config: ProfileConfig): EligibilityDecision {
  if (input.hardChecks.status !== "PENDING_AI") {
    return {
      decision: input.hardChecks.status === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "REJECTED",
      tier: null,
      reasons: input.hardChecks.rejectionReasons,
      blockingRiskFlags: [],
    };
  }
  if (!input.ai || input.authoritativeScore === null) {
    return {
      decision: "AI_ERROR",
      tier: null,
      reasons: ["AI output was invalid; job not notified"],
      blockingRiskFlags: [],
    };
  }
  if (input.alreadyNotified) {
    return {
      decision: "REJECTED",
      tier: null,
      reasons: ["Already notified to this recipient"],
      blockingRiskFlags: [],
    };
  }

  const listed = new Set(config.ai.disqualifyingRiskFlags.map((f) => f.toUpperCase()));
  const disqualifying = input.ai.risk_flags.filter((f) => listed.has(f.code.toUpperCase()));
  if (disqualifying.length > 0) {
    return {
      decision: "REJECTED",
      tier: "COLD",
      reasons: [`Disqualifying risk: ${disqualifying.map((f) => f.code).join(", ")}`],
      blockingRiskFlags: disqualifying,
    };
  }

  const hotMin = config.ai.minScore;
  const warmMin = warmThreshold(config);
  if (input.authoritativeScore < warmMin) {
    return {
      decision: "REJECTED",
      tier: "COLD",
      reasons: [`Score ${input.authoritativeScore} is below the lead threshold of ${warmMin}`],
      blockingRiskFlags: [],
    };
  }
  const tier: LeadTier = input.authoritativeScore >= hotMin ? "HOT" : "WARM";

  const threshold = BLOCKING_SEVERITY[config.ai.riskSensitivity];
  const severe = input.ai.risk_flags.filter((f) => SEVERITY_RANK[f.severity] >= threshold);
  if (severe.length > 0) {
    return {
      decision: "NEEDS_REVIEW",
      tier,
      reasons: [`Risk flags need review: ${severe.map((f) => `${f.code} (${f.severity})`).join(", ")}`],
      blockingRiskFlags: severe,
    };
  }

  return {
    decision: "QUALIFIED",
    tier,
    reasons: [
      tier === "HOT"
        ? `Hot lead: score ${input.authoritativeScore} meets the alert threshold of ${hotMin}`
        : `Warm lead: score ${input.authoritativeScore} is between ${warmMin} and ${hotMin} (kept, not alerted)`,
    ],
    blockingRiskFlags: [],
  };
}
