import { z } from "zod";
import { isDecimalString, isValidRate, toCents } from "@/lib/money/decimal";

/**
 * Search-profile configuration. Every qualification rule the user can change
 * lives here; it is validated on the server, stored as JSONB, versioned in
 * profile_versions and snapshotted into each run.
 */

export const CONFIG_SCHEMA_VERSION = 1;

const term = z.string().trim().min(1).max(80);
const termList = (max = 50) =>
  z
    .array(term)
    .max(max)
    .transform((list) => dedupeCaseInsensitive(list));

const decimalAmount = z
  .string()
  .trim()
  .refine(isDecimalString, "Must be a non-negative amount with up to 2 decimals");

export const skillTermSchema = z.object({
  name: term,
  /** Alternative spellings / synonyms that count as the same skill. */
  aliases: termList(20).default([]),
});
export type SkillTerm = z.infer<typeof skillTermSchema>;

export const scoringWeightsSchema = z
  .object({
    skillAlignment: z.number().int().min(0).max(100),
    scopeFit: z.number().int().min(0).max(100),
    descriptionClarity: z.number().int().min(0).max(100),
    clientCredibility: z.number().int().min(0).max(100),
    overallRelevance: z.number().int().min(0).max(100),
  })
  .refine((w) => Object.values(w).reduce((a, b) => a + b, 0) === 100, {
    message: "Weights must add up to exactly 100",
  });
export type ScoringWeights = z.infer<typeof scoringWeightsSchema>;

export const unknownPolicy = z.enum(["FAIL", "NEEDS_REVIEW", "IGNORE"]);
export type UnknownPolicy = z.infer<typeof unknownPolicy>;

export const profileConfigSchema = z
  .object({
    schemaVersion: z.literal(CONFIG_SCHEMA_VERSION).default(CONFIG_SCHEMA_VERSION),
    general: z.object({
      /** Optional cap on AI evaluations per run (cost control). null = no cap. */
      maxJobsToEvaluate: z.number().int().min(1).max(500).nullable(),
    }),
    skills: z.object({
      required: z.array(skillTermSchema).max(30),
      /** ANY: at least one required skill; ALL: every required skill; AT_LEAST: minRequiredMatches. */
      requiredMatchMode: z.enum(["ANY", "ALL", "AT_LEAST"]),
      minRequiredMatches: z.number().int().min(1).max(30),
      optional: z.array(skillTermSchema).max(30),
      includeKeywords: termList(),
      excludeKeywords: termList(),
      /** Each combination is a set of terms that must all appear; at least one combination must match. */
      requiredCombinations: z.array(termList(10).pipe(z.array(term).min(2))).max(20),
      category: z.string().trim().max(120).nullable(),
    }),
    budget: z.object({
      jobType: z.enum(["FIXED", "HOURLY", "BOTH"]),
      fixedMin: decimalAmount.nullable(),
      fixedMax: decimalAmount.nullable(),
      hourlyMin: decimalAmount.nullable(),
      currency: z
        .string()
        .trim()
        .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code"),
      currencyPolicy: z.object({
        /** SAME_CURRENCY_ONLY: other currencies are UNKNOWN. FIXED_RATES: convert with the rates below. */
        mode: z.enum(["SAME_CURRENCY_ONLY", "FIXED_RATES"]),
        /** Units of the profile currency per one unit of the foreign currency, e.g. { EUR: "1.08" }. */
        rates: z.record(z.string().regex(/^[A-Z]{3}$/), z.string().refine(isValidRate, "Invalid rate")),
      }),
      /** How a range budget is reduced to one comparable value. Only LOWER_BOUND is supported (conservative). */
      rangePolicy: z.literal("LOWER_BOUND"),
      missingBudgetPolicy: unknownPolicy.exclude(["IGNORE"]),
    }),
    client: z.object({
      paymentVerificationRequired: z.boolean(),
      minRating: z.number().min(0).max(5).nullable(),
      minHires: z.number().int().min(0).max(100000).nullable(),
      minTotalSpent: decimalAmount.nullable(),
      allowedCountries: termList(100),
      blockedCountries: termList(100),
      /** Applies to optional client checks when the source does not supply the data. */
      unknownClientDataPolicy: unknownPolicy,
    }),
    ai: z.object({
      minScore: z.number().int().min(0).max(100),
      weights: scoringWeightsSchema,
      /** LOW: only listed flags block; MEDIUM: HIGH-severity flags block; HIGH: MEDIUM+ flags block. */
      riskSensitivity: z.enum(["LOW", "MEDIUM", "HIGH"]),
      disqualifyingRiskFlags: termList(30),
      maxRetries: z.number().int().min(0).max(3),
    }),
    notifications: z.object({
      whatsappEnabled: z.boolean(),
      recipientId: z.uuid().nullable(),
      maxPerRun: z.number().int().min(1).max(50),
      messageFormat: z.enum(["STANDARD", "COMPACT"]),
      sendRunSummary: z.boolean(),
      alertOnFailure: z.boolean(),
    }),
  })
  .superRefine((config, ctx) => {
    const { budget, skills } = config;
    if (budget.fixedMin && budget.fixedMax && toCents(budget.fixedMin)! > toCents(budget.fixedMax)!) {
      ctx.addIssue({ code: "custom", path: ["budget", "fixedMax"], message: "Maximum must be ≥ minimum" });
    }
    if (skills.requiredMatchMode === "AT_LEAST" && skills.minRequiredMatches > skills.required.length) {
      ctx.addIssue({
        code: "custom",
        path: ["skills", "minRequiredMatches"],
        message: "Cannot require more matches than there are required skills",
      });
    }
    if (skills.requiredMatchMode !== "ANY" && skills.required.length === 0) {
      ctx.addIssue({ code: "custom", path: ["skills", "required"], message: "Add at least one required skill" });
    }
    if (budget.currencyPolicy.mode === "FIXED_RATES" && Object.keys(budget.currencyPolicy.rates).length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["budget", "currencyPolicy", "rates"],
        message: "Add at least one exchange rate or use same-currency only",
      });
    }
    const included = new Set(skills.includeKeywords.map((k) => k.toLowerCase()));
    const overlap = skills.excludeKeywords.filter((k) => included.has(k.toLowerCase()));
    if (overlap.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["skills", "excludeKeywords"],
        message: `Keywords cannot be both included and excluded: ${overlap.join(", ")}`,
      });
    }
    if (config.notifications.whatsappEnabled && !config.notifications.recipientId) {
      ctx.addIssue({
        code: "custom",
        path: ["notifications", "recipientId"],
        message: "Select a recipient or disable WhatsApp notifications",
      });
    }
  });

export type ProfileConfig = z.infer<typeof profileConfigSchema>;
export type ProfileConfigInput = z.input<typeof profileConfigSchema>;

/** Initial business configuration ("Web & Zoho Development"). Defaults only — never hardcoded rules. */
export function defaultProfileConfig(recipientId: string | null = null): ProfileConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    general: { maxJobsToEvaluate: 50 },
    skills: {
      required: [
        { name: "React", aliases: ["React.js", "ReactJS"] },
        { name: "Node.js", aliases: ["NodeJS", "Node JS"] },
        { name: "JavaScript", aliases: ["JS"] },
        { name: "Zoho", aliases: ["Zoho CRM", "Zoho Creator", "Deluge"] },
        { name: "API integrations", aliases: ["API integration", "REST API", "Webhooks"] },
      ],
      requiredMatchMode: "ANY",
      minRequiredMatches: 1,
      optional: [
        { name: "Next.js", aliases: ["NextJS"] },
        { name: "PostgreSQL", aliases: ["Postgres"] },
      ],
      includeKeywords: [],
      excludeKeywords: [],
      requiredCombinations: [],
      category: null,
    },
    budget: {
      jobType: "FIXED",
      fixedMin: "500.00",
      fixedMax: null,
      hourlyMin: null,
      currency: "USD",
      currencyPolicy: { mode: "SAME_CURRENCY_ONLY", rates: {} },
      rangePolicy: "LOWER_BOUND",
      missingBudgetPolicy: "FAIL",
    },
    client: {
      paymentVerificationRequired: true,
      minRating: null,
      minHires: null,
      minTotalSpent: null,
      allowedCountries: [],
      blockedCountries: [],
      unknownClientDataPolicy: "FAIL",
    },
    ai: {
      minScore: 75,
      weights: {
        skillAlignment: 35,
        scopeFit: 25,
        descriptionClarity: 15,
        clientCredibility: 15,
        overallRelevance: 10,
      },
      riskSensitivity: "MEDIUM",
      disqualifyingRiskFlags: [],
      maxRetries: 2,
    },
    notifications: {
      whatsappEnabled: recipientId !== null,
      recipientId,
      maxPerRun: 10,
      messageFormat: "STANDARD",
      sendRunSummary: false,
      alertOnFailure: true,
    },
  };
}

function dedupeCaseInsensitive(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
