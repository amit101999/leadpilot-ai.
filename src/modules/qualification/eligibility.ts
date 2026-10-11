import type { AiOutput, RiskFlag } from "@/modules/ai/output-schema";
import type { ProfileConfig } from "@/modules/profiles/config-schema";
import type { QualificationDecision } from "@/types/domain";
import type { HardCheckSummary } from "./hard-filters";

export interface EligibilityInput {
  hardChecks: HardCheckSummary;
  /** null when the AI output never passed validation. */
  ai: AiOutput | null;
  authoritativeScore: number | null;
  alreadyNotified: boolean;
}

export interface EligibilityDecision {
  decision: QualificationDecision;
  reasons: string[];
  blockingRiskFlags: RiskFlag[];
}

const SEVERITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3 } as const;
/** Minimum severity rank that blocks qualification for each sensitivity level. */
const BLOCKING_SEVERITY = { LOW: Number.POSITIVE_INFINITY, MEDIUM: 3, HIGH: 2 } as const;

/**
 * Final deterministic check (pipeline stage 7). AI can only lower a job's
 * standing: hard-filter results are re-asserted here, so no model output can
 * bypass a mandatory business rule.
 */
export function decideEligibility(input: EligibilityInput, config: ProfileConfig): EligibilityDecision {
  if (input.hardChecks.status !== "PENDING_AI") {
    return {
      decision: input.hardChecks.status === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "REJECTED",
      reasons: input.hardChecks.rejectionReasons,
      blockingRiskFlags: [],
    };
  }
  if (!input.ai || input.authoritativeScore === null) {
    return { decision: "AI_ERROR", reasons: ["AI output was invalid; job not notified"], blockingRiskFlags: [] };
  }
  if (input.alreadyNotified) {
    return { decision: "REJECTED", reasons: ["Already notified to this recipient"], blockingRiskFlags: [] };
  }

  const listed = new Set(config.ai.disqualifyingRiskFlags.map((f) => f.toUpperCase()));
  const disqualifying = input.ai.risk_flags.filter((f) => listed.has(f.code.toUpperCase()));
  if (disqualifying.length > 0) {
    return {
      decision: "REJECTED",
      reasons: [`Disqualifying risk: ${disqualifying.map((f) => f.code).join(", ")}`],
      blockingRiskFlags: disqualifying,
    };
  }

  if (input.authoritativeScore < config.ai.minScore) {
    return {
      decision: "REJECTED",
      reasons: [`Score ${input.authoritativeScore} is below the threshold of ${config.ai.minScore}`],
      blockingRiskFlags: [],
    };
  }

  const threshold = BLOCKING_SEVERITY[config.ai.riskSensitivity];
  const severe = input.ai.risk_flags.filter((f) => SEVERITY_RANK[f.severity] >= threshold);
  if (severe.length > 0) {
    return {
      decision: "NEEDS_REVIEW",
      reasons: [`Risk flags need review: ${severe.map((f) => `${f.code} (${f.severity})`).join(", ")}`],
      blockingRiskFlags: severe,
    };
  }

  return {
    decision: "QUALIFIED",
    reasons: [`Score ${input.authoritativeScore} meets the threshold of ${config.ai.minScore}`],
    blockingRiskFlags: [],
  };
}
