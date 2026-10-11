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

export interface AiEvaluator {
  readonly id: string;
  readonly model: string;
  readonly isMock: boolean;
  /** Returns the raw model output (validated by the caller). Throws AiProviderError on transport failure. */
  evaluate(input: EvaluationInput): Promise<unknown>;
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
    readonly kind: "TIMEOUT" | "RATE_LIMIT" | "PROVIDER" | "NOT_CONFIGURED",
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
