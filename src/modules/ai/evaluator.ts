import { createHash } from "node:crypto";
import type { NormalizedJob } from "@/modules/job-sources/types";
import type { ProfileConfig } from "@/modules/profiles/config-schema";

/** Minimal, non-sensitive slice of the profile sent to the model. */
export interface EvaluationProfile {
  requiredSkills: string[];
  optionalSkills: string[];
  category: string | null;
  riskSensitivity: ProfileConfig["ai"]["riskSensitivity"];
}

export interface EvaluationInput {
  job: NormalizedJob;
  profile: EvaluationProfile;
}

/** Token counts reported by the provider for one call. Null when the provider reports none (mock). */
export interface AiUsage {
  /** Model snapshot the provider actually used, e.g. "gpt-4o-mini-2024-07-18". */
  model: string;
  inputTokens: number;
  /** Subset of inputTokens served from the prompt cache (billed at the cached rate). */
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface AiEvaluation {
  /** Raw model output (validated by the caller). */
  output: unknown;
  usage: AiUsage | null;
}

export interface AiEvaluator {
  readonly id: string;
  readonly model: string;
  readonly isMock: boolean;
  /** Throws AiProviderError on transport failure. */
  evaluate(input: EvaluationInput): Promise<AiEvaluation>;
  checkConfiguration(): { configured: boolean; message: string };
  /** Live, cost-free credential check (no evaluation request). */
  checkConnection(): Promise<AiConnection>;
}

export interface AiConnection {
  state: "CONNECTED" | "NOT_CONFIGURED" | "NOT_AUTHORIZED" | "UNAVAILABLE" | "MOCK";
  message: string;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    /** REJECTED: the request itself was refused (bad key, no access, bad request); retrying cannot help. */
    readonly kind: "TIMEOUT" | "RATE_LIMIT" | "PROVIDER" | "REJECTED" | "NOT_CONFIGURED",
    /** HTTP status when the provider answered with an error; null for timeouts and connection failures. */
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export function toEvaluationProfile(config: ProfileConfig): EvaluationProfile {
  return {
    requiredSkills: config.skills.required.map((s) => s.name),
    optionalSkills: config.skills.optional.map((s) => s.name),
    category: config.skills.category,
    riskSensitivity: config.ai.riskSensitivity,
  };
}

/** Reference to the exact model input, stored instead of the input itself. */
export function hashEvaluationInput(input: EvaluationInput, promptVersion: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ promptVersion, job: input.job, profile: input.profile }))
    .digest("hex");
}
