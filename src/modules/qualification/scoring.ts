import type { DimensionScores } from "@/modules/ai/output-schema";
import type { ScoringWeights } from "@/modules/profiles/config-schema";

export const RUBRIC_VERSION = "rubric-2026-10-v1";

const WEIGHT_FOR: Record<keyof DimensionScores, keyof ScoringWeights> = {
  skill_alignment: "skillAlignment",
  scope_fit: "scopeFit",
  description_clarity: "descriptionClarity",
  client_credibility: "clientCredibility",
  overall_relevance: "overallRelevance",
};

/**
 * Authoritative score: weighted mean of the dimension scores using integer
 * arithmetic and round-half-up. The model's own "score" field is never used.
 */
export function computeAuthoritativeScore(dimensions: DimensionScores, weights: ScoringWeights): number {
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  if (totalWeight !== 100) throw new Error(`Weights must sum to 100 (got ${totalWeight})`);
  let weighted = 0;
  for (const [dimension, weightKey] of Object.entries(WEIGHT_FOR) as Array<
    [keyof DimensionScores, keyof ScoringWeights]
  >) {
    const value = dimensions[dimension];
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new Error(`Dimension ${dimension} out of range`);
    }
    weighted += value * weights[weightKey];
  }
  return Math.floor((weighted + 50) / 100);
}

/** Rescales non-negative weights to integers summing to exactly 100 (largest-remainder method). */
export function normalizeWeights(weights: ScoringWeights): ScoringWeights {
  const entries = Object.entries(weights) as Array<[keyof ScoringWeights, number]>;
  const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  if (total === 0) {
    return { skillAlignment: 20, scopeFit: 20, descriptionClarity: 20, clientCredibility: 20, overallRelevance: 20 };
  }
  const parts = entries.map(([key, w]) => {
    const exact = (Math.max(0, w) * 100) / total;
    return { key, value: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let missing = 100 - parts.reduce((sum, p) => sum + p.value, 0);
  for (const part of [...parts].sort((a, b) => b.remainder - a.remainder)) {
    if (missing === 0) break;
    part.value += 1;
    missing -= 1;
  }
  return Object.fromEntries(parts.map((p) => [p.key, p.value])) as ScoringWeights;
}
