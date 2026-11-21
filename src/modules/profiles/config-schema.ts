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

export const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");
export const timeZone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone");

/** Search keywords and the import agent's schedule. Defaults keep older stored configurations valid. */
export const searchConfigSchema = z.object({
  /** Used by the import agent to search the source, and by the keyword-coverage rule. */
  keywords: termList(20),
  /** Minimum share of keywords that must appear in the job (title, description, skills). null = rule off. */
  keywordCoveragePercent: z.number().int().min(1).max(100).nullable(),
  /**
   * Superseded by the app-wide sync scheduler (src/modules/scheduler); no longer read. Kept so stored
   * versions keep loading and their history still shows the old per-profile settings.
   */
  upworkSync: z.object({
    enabled: z.boolean(),
    everyHours: z.number().int().min(1).max(24),
    activeFrom: clockTime,
    activeTo: clockTime,
    timezone: timeZone,
  }),
});
export type SearchConfig = z.infer<typeof searchConfigSchema>;

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  keywords: [],
  keywordCoveragePercent: null,
  upworkSync: { enabled: false, everyHours: 4, activeFrom: "00:00", activeTo: "23:59", timezone: "UTC" },
};

/** Upwork's proposal bands, fewest first. A posting's band is compared with the profile's maximum. */
export const PROPOSAL_TIERS = ["Less than 5", "5 to 10", "10 to 15", "15 to 20", "20 to 50", "50+"] as const;
/** Bands a profile can set as its maximum ("50+" would allow everything, so it is not offered). */
const MAX_PROPOSAL_TIERS = ["Less than 5", "5 to 10", "10 to 15", "15 to 20", "20 to 50"] as const;

/**
 * Competition on a posting, from the team's hunting checklist: avoid crowded postings, postings where
 * the client is already interviewing or inviting many freelancers, and postings already filled.
 */
export const DEFAULT_COMPETITION = {
  maxProposalsTier: "10 to 15" as (typeof MAX_PROPOSAL_TIERS)[number] | null,
  maxInterviewing: 3 as number | null,
  maxInvitesSent: 10 as number | null,
  rejectIfHired: true,
};

/** Developed markets the team prioritizes: USA, Canada, Australia, UK and Europe (Upwork's country names). */
export const DEFAULT_PREFERRED_COUNTRIES = [
  "United States",
  "Canada",
  "Australia",
  "United Kingdom",
  "Austria",
  "Belgium",
  "Bulgaria",
  "Croatia",
  "Cyprus",
  "Czech Republic",
  "Denmark",
  "Estonia",
  "Finland",
  "France",
  "Germany",
  "Greece",
  "Hungary",
  "Ireland",
  "Italy",
  "Latvia",
  "Lithuania",
  "Luxembourg",
  "Malta",
  "Netherlands",
  "Poland",
  "Portugal",
  "Romania",
  "Slovakia",
  "Slovenia",
  "Spain",
  "Sweden",
  "Switzerland",
  "Norway",
  "Iceland",
];

export const DEFAULT_MIN_HIRE_RATE = 50;
export const DEFAULT_PREFERRED_COUNTRY_BONUS = 5;

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
      /** Minimum share of the client's posted jobs that led to a hire. null = rule off. */
      minHireRatePercent: z.number().int().min(0).max(100).nullable().default(DEFAULT_MIN_HIRE_RATE),
      /** Countries that earn the priority bonus (ai.preferredCountryBonus); others are not rejected. */
      preferredCountries: termList(100).default(() => [...DEFAULT_PREFERRED_COUNTRIES]),
      /** Applies to optional client checks when the source does not supply the data. */
      unknownClientDataPolicy: unknownPolicy,
    }),
    competition: z
      .object({
        /** Highest proposal band still worth a proposal. null = rule off. */
        maxProposalsTier: z.enum(MAX_PROPOSAL_TIERS).nullable(),
        /** Most freelancers the client may already be interviewing. null = rule off. */
        maxInterviewing: z.number().int().min(0).max(100).nullable(),
        /** Most invitations the client may already have sent. null = rule off. */
        maxInvitesSent: z.number().int().min(0).max(1000).nullable(),
        /** Skip postings where the client already hired someone. */
        rejectIfHired: z.boolean(),
      })
      .default(() => ({ ...DEFAULT_COMPETITION })),
    ai: z.object({
      minScore: z.number().int().min(0).max(100),
      weights: scoringWeightsSchema,
      /** LOW: only listed flags block; MEDIUM: HIGH-severity flags block; HIGH: MEDIUM+ flags block. */
      riskSensitivity: z.enum(["LOW", "MEDIUM", "HIGH"]),
      disqualifyingRiskFlags: termList(30),
      maxRetries: z.number().int().min(0).max(3),
      /** Points added to the score when the client is in a preferred country (capped at 100). */
      preferredCountryBonus: z.number().int().min(0).max(20).default(DEFAULT_PREFERRED_COUNTRY_BONUS),
    }),
    // Configurations saved while WhatsApp alerts existed also hold `whatsappEnabled` and `recipientId`;
    // unknown keys are dropped when parsing, so those versions still load.
    notifications: z.object({
      emailEnabled: z.boolean().default(false),
      emailRecipientId: z.uuid().nullable().default(null),
      /** At most this many leads are alerted per run. */
      maxPerRun: z.number().int().min(1).max(50),
      messageFormat: z.enum(["STANDARD", "COMPACT"]),
      sendRunSummary: z.boolean(),
      alertOnFailure: z.boolean(),
    }),
    // A fresh copy each time: callers may change the parsed config, and must never change the default.
    search: searchConfigSchema.default(() => structuredClone(DEFAULT_SEARCH_CONFIG)),
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
      ctx.addIssue({
        code: "custom",
        path: ["skills", "required"],
        message: "Add at least one required skill",
      });
    }
    if (
      budget.currencyPolicy.mode === "FIXED_RATES" &&
      Object.keys(budget.currencyPolicy.rates).length === 0
    ) {
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
    if (config.notifications.emailEnabled && !config.notifications.emailRecipientId) {
      ctx.addIssue({
        code: "custom",
        path: ["notifications", "emailRecipientId"],
        message: "Select an e-mail recipient or disable e-mail notifications",
      });
    }
    const { search } = config;
    if (search.keywords.length === 0) {
      if (search.keywordCoveragePercent !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["search", "keywordCoveragePercent"],
          message: "Add keywords or turn the coverage rule off",
        });
      }
    }
  });

export type ProfileConfig = z.infer<typeof profileConfigSchema>;

/** Initial business configuration ("Web & Zoho Development"). Defaults only — never hardcoded rules. */
export function defaultProfileConfig(emailRecipientId: string | null = null): ProfileConfig {
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
      minHireRatePercent: DEFAULT_MIN_HIRE_RATE,
      preferredCountries: [...DEFAULT_PREFERRED_COUNTRIES],
      // Imported jobs often lack some client data; review rather than silently drop them.
      unknownClientDataPolicy: "NEEDS_REVIEW",
    },
    competition: { ...DEFAULT_COMPETITION },
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
      preferredCountryBonus: DEFAULT_PREFERRED_COUNTRY_BONUS,
    },
    notifications: {
      emailEnabled: emailRecipientId !== null,
      emailRecipientId,
      maxPerRun: 10,
      messageFormat: "STANDARD",
      sendRunSummary: false,
      alertOnFailure: true,
    },
    search: {
      // A deep copy, so changing this profile's schedule never changes the shared default.
      ...structuredClone(DEFAULT_SEARCH_CONFIG),
      keywords: ["React", "Node.js", "Zoho", "API integration"],
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
