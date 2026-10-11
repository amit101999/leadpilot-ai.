import { z } from "zod";

/**
 * Contract for the model's structured output. Every object is strict and every
 * property required so it can be used with OpenAI strict structured outputs.
 * The backend re-validates the response with this schema regardless.
 */

export const DIMENSIONS = [
  "skill_alignment",
  "scope_fit",
  "description_clarity",
  "client_credibility",
  "overall_relevance",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

const score = z.number().int().min(0).max(100);
const shortText = z.string().max(600);
const textList = z.array(z.string().max(300)).max(10);

export const riskFlagSchema = z.strictObject({
  code: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{2,40}$/)
    .describe("UPPER_SNAKE_CASE identifier, e.g. VAGUE_SCOPE, OFF_PLATFORM_PAYMENT"),
  severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  evidence: shortText.describe("Quote or field from the supplied job data supporting this flag"),
});
export type RiskFlag = z.infer<typeof riskFlagSchema>;

const dimensionDetail = z.strictObject({
  evidence: textList.describe("Facts taken only from the supplied job fields"),
  explanation: shortText,
  missing_information: textList,
});

export const aiOutputSchema = z.strictObject({
  score: score.describe("Your overall estimate. Informational only; the backend recomputes it."),
  dimension_scores: z.strictObject({
    skill_alignment: score,
    scope_fit: score,
    description_clarity: score,
    client_credibility: score,
    overall_relevance: score,
  }),
  dimension_details: z.strictObject({
    skill_alignment: dimensionDetail,
    scope_fit: dimensionDetail,
    description_clarity: dimensionDetail,
    client_credibility: dimensionDetail,
    overall_relevance: dimensionDetail,
  }),
  skill_matches: z.array(z.string().max(80)).max(30),
  scope_summary: shortText,
  positive_signals: textList,
  risk_flags: z.array(riskFlagSchema).max(15),
  missing_information: textList,
  reasoning_summary: z.string().max(1000),
});

export type AiOutput = z.infer<typeof aiOutputSchema>;
export type DimensionScores = AiOutput["dimension_scores"];

/** JSON Schema sent to the model provider. */
export function aiOutputJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(aiOutputSchema, { target: "draft-7" }) as Record<string, unknown>;
}

export type AiValidation = { ok: true; value: AiOutput } | { ok: false; error: string };

export function validateAiOutput(raw: unknown): AiValidation {
  let candidate = raw;
  if (typeof raw === "string") {
    try {
      candidate = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Response is not valid JSON" };
    }
  }
  const parsed = aiOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Schema validation failed: ${issues}` };
  }
  return { ok: true, value: parsed.data };
}
