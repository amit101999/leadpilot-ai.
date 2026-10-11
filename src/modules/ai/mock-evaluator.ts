import type { AiOutput } from "./output-schema";
import type { AiConnection, AiEvaluator, EvaluationInput } from "./evaluator";
import { AiProviderError } from "./evaluator";

/**
 * Deterministic evaluator for development and tests. Makes no network calls.
 *
 * Mock job-source records may carry `sourceMetadata.mockAi` to script the
 * outcome (fixed dimension scores, invalid output, timeouts); otherwise a
 * simple skill-overlap heuristic is used. Results are clearly labelled as
 * mock in the UI via the model identifier.
 */
export interface MockAiScript {
  dimensions?: Partial<AiOutput["dimension_scores"]>;
  riskFlags?: AiOutput["risk_flags"];
  /** "invalid": always return schema-invalid output; "timeout": always throw a timeout. */
  behavior?: "invalid" | "timeout" | "invalid-once";
}

export class MockAiEvaluator implements AiEvaluator {
  readonly id = "mock";
  readonly model = "mock-evaluator-v1";
  readonly isMock = true;
  private readonly calls = new Map<string, number>();

  async evaluate(input: EvaluationInput): Promise<unknown> {
    const script = (input.job.sourceMetadata.mockAi ?? {}) as MockAiScript;
    const callCount = (this.calls.get(input.job.sourceJobId) ?? 0) + 1;
    this.calls.set(input.job.sourceJobId, callCount);

    if (script.behavior === "timeout") throw new AiProviderError("Mock evaluator timeout", "TIMEOUT");
    if (script.behavior === "invalid" || (script.behavior === "invalid-once" && callCount === 1)) {
      return { score: "high", note: "not the expected schema" };
    }

    const heuristic = heuristicScore(input);
    const dims = {
      skill_alignment: heuristic,
      scope_fit: heuristic,
      description_clarity: heuristic,
      client_credibility: heuristic,
      overall_relevance: heuristic,
      ...script.dimensions,
    };
    const detail = (text: string) => ({ evidence: [text], explanation: text, missing_information: [] });
    const output: AiOutput = {
      score: Math.round(Object.values(dims).reduce((a, b) => a + b, 0) / 5),
      dimension_scores: dims,
      dimension_details: {
        skill_alignment: detail(`Job skills: ${input.job.skills.join(", ") || "none listed"}`),
        scope_fit: detail("Mock assessment of project scope"),
        description_clarity: detail(`Description length ${input.job.description.length} characters`),
        client_credibility: detail(
          `Payment verified: ${input.job.paymentVerified === null ? "unknown" : String(input.job.paymentVerified)}`,
        ),
        overall_relevance: detail("Mock overall relevance"),
      },
      skill_matches: input.profile.requiredSkills.filter((skill) =>
        `${input.job.title} ${input.job.skills.join(" ")}`.toLowerCase().includes(skill.toLowerCase()),
      ),
      scope_summary: input.job.title.slice(0, 200),
      positive_signals: [],
      risk_flags: script.riskFlags ?? [],
      missing_information: input.job.clientRating === null ? ["Client rating not provided"] : [],
      reasoning_summary: "Deterministic mock evaluation (no AI provider called).",
    };
    return output;
  }

  checkConfiguration() {
    return { configured: true, message: "Mock evaluator (no external AI calls)" };
  }

  async checkConnection(): Promise<AiConnection> {
    return { state: "MOCK", message: "Mock evaluator: no external AI calls are made" };
  }
}

function heuristicScore(input: EvaluationInput): number {
  const haystack = `${input.job.title} ${input.job.skills.join(" ")} ${input.job.description}`.toLowerCase();
  const required = input.profile.requiredSkills;
  if (required.length === 0) return 70;
  const hits = required.filter((skill) => haystack.includes(skill.toLowerCase())).length;
  return Math.min(95, 55 + Math.round((hits / required.length) * 40));
}
