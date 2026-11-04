import { centsToString, convertCents, toCents, type Cents } from "@/lib/money/decimal";
import { validateJobUrl } from "@/lib/security/url";
import type { NormalizedJob } from "@/modules/job-sources/types";
import { enabledChannels } from "@/modules/notifications/channels";
import type { ProfileConfig, UnknownPolicy } from "@/modules/profiles/config-schema";
import {
  containsTerm,
  matchSkill,
  toSearchable,
  type SearchableJob,
  type TermMatch,
} from "./keyword-matching";

export type CheckOutcome = "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";
/** What a check result means for the job: continue, reject outright, or park for manual review. */
export type CheckEffect = "CONTINUE" | "REJECT" | "REVIEW";

export type HardRule =
  | "SOURCE_AUTHORIZED"
  | "STABLE_IDENTIFIER"
  | "VALID_URL"
  | "DATA_SUFFICIENCY"
  | "JOB_TYPE"
  | "CURRENCY"
  | "BUDGET"
  | "PAYMENT_VERIFIED"
  | "CLIENT_RATING"
  | "CLIENT_HIRES"
  | "CLIENT_SPEND"
  | "CLIENT_LOCATION"
  | "CATEGORY"
  | "REQUIRED_SKILLS"
  | "INCLUDE_KEYWORDS"
  | "EXCLUDE_KEYWORDS"
  | "REQUIRED_COMBINATIONS"
  | "KEYWORD_COVERAGE"
  | "NOT_PREVIOUSLY_NOTIFIED";

export interface HardCheckResult {
  rule: HardRule;
  outcome: CheckOutcome;
  effect: CheckEffect;
  reasonCode: string;
  message: string;
  observed?: unknown;
  expected?: unknown;
}

export interface HardCheckContext {
  sourceAuthorized: boolean;
  /** True when this job already has an active/sent claim for every enabled channel's recipient. */
  alreadyNotified: boolean;
}

export interface HardCheckSummary {
  results: HardCheckResult[];
  /** PENDING_AI when every check allows continuing, otherwise the terminal status. */
  status: "PENDING_AI" | "FILTERED_OUT" | "NEEDS_REVIEW";
  rejectionReasons: string[];
  skillMatches: TermMatch[];
}

const MIN_DESCRIPTION_LENGTH = 50;
const STABLE_ID_RE = /^[A-Za-z0-9._:~-]{1,200}$/;

export function evaluateHardChecks(
  job: NormalizedJob,
  config: ProfileConfig,
  context: HardCheckContext,
): HardCheckSummary {
  const searchable = toSearchable(job);
  const skillMatches = config.skills.required.map((skill) => matchSkill(searchable, skill));

  const results: HardCheckResult[] = [
    checkSourceAuthorized(context),
    checkStableIdentifier(job),
    checkUrl(job),
    checkDataSufficiency(job),
    checkJobType(job, config),
    ...checkBudget(job, config),
    checkPaymentVerified(job, config),
    ...checkClient(job, config),
    checkCategory(job, config),
    checkRequiredSkills(skillMatches, config),
    checkIncludeKeywords(searchable, config),
    checkExcludeKeywords(searchable, config),
    checkRequiredCombinations(searchable, config),
    checkKeywordCoverage(searchable, config),
    checkNotPreviouslyNotified(config, context),
  ];

  const rejected = results.filter((r) => r.effect === "REJECT");
  const review = results.filter((r) => r.effect === "REVIEW");
  const status = rejected.length > 0 ? "FILTERED_OUT" : review.length > 0 ? "NEEDS_REVIEW" : "PENDING_AI";
  const rejectionReasons = (rejected.length > 0 ? rejected : review).map((r) => r.message);
  return { results, status, rejectionReasons, skillMatches };
}

// ---------------------------------------------------------------------------

function result(
  rule: HardRule,
  outcome: CheckOutcome,
  effect: CheckEffect,
  reasonCode: string,
  message: string,
  extra: Pick<HardCheckResult, "observed" | "expected"> = {},
): HardCheckResult {
  return { rule, outcome, effect, reasonCode, message, ...extra };
}

const pass = (rule: HardRule, message: string, extra?: Pick<HardCheckResult, "observed" | "expected">) =>
  result(rule, "PASS", "CONTINUE", "OK", message, extra);
const notApplicable = (rule: HardRule, message: string) =>
  result(rule, "NOT_APPLICABLE", "CONTINUE", "NOT_CONFIGURED", message);

function unknownEffect(policy: UnknownPolicy): CheckEffect {
  return policy === "FAIL" ? "REJECT" : policy === "NEEDS_REVIEW" ? "REVIEW" : "CONTINUE";
}

function checkSourceAuthorized(context: HardCheckContext): HardCheckResult {
  return context.sourceAuthorized
    ? pass("SOURCE_AUTHORIZED", "Job source is authorized")
    : result("SOURCE_AUTHORIZED", "FAIL", "REJECT", "SOURCE_NOT_AUTHORIZED", "Job source is not authorized");
}

function checkStableIdentifier(job: NormalizedJob): HardCheckResult {
  return STABLE_ID_RE.test(job.sourceJobId)
    ? pass("STABLE_IDENTIFIER", "Job has a stable source identifier")
    : result(
        "STABLE_IDENTIFIER",
        "FAIL",
        "REJECT",
        "INVALID_SOURCE_ID",
        "Job has no stable source identifier",
      );
}

function checkUrl(job: NormalizedJob): HardCheckResult {
  const validation = validateJobUrl(job.jobUrl, job.source);
  return validation.ok
    ? pass("VALID_URL", "Job has a valid source-provided URL")
    : result(
        "VALID_URL",
        "FAIL",
        "REJECT",
        validation.reason,
        `Job URL is not usable (${validation.reason})`,
      );
}

function checkDataSufficiency(job: NormalizedJob): HardCheckResult {
  if (job.title.trim().length === 0) {
    return result("DATA_SUFFICIENCY", "FAIL", "REJECT", "MISSING_TITLE", "Job has no title");
  }
  if (job.description.trim().length < MIN_DESCRIPTION_LENGTH) {
    return result(
      "DATA_SUFFICIENCY",
      "UNKNOWN",
      "REVIEW",
      "DESCRIPTION_TOO_SHORT",
      "Description is too short to assess",
      { observed: job.description.trim().length, expected: `>= ${MIN_DESCRIPTION_LENGTH} characters` },
    );
  }
  return pass("DATA_SUFFICIENCY", "Job data is sufficient for evaluation");
}

function checkJobType(job: NormalizedJob, config: ProfileConfig): HardCheckResult {
  const wanted = config.budget.jobType;
  const extra = { observed: job.budgetType, expected: wanted };
  if (job.budgetType === "UNKNOWN") {
    return result("JOB_TYPE", "UNKNOWN", "REJECT", "JOB_TYPE_UNKNOWN", "Job type is unknown", extra);
  }
  if (wanted === "BOTH" || wanted === job.budgetType) return pass("JOB_TYPE", "Job type matches", extra);
  return result(
    "JOB_TYPE",
    "FAIL",
    "REJECT",
    "JOB_TYPE_MISMATCH",
    `${job.budgetType === "HOURLY" ? "Hourly" : "Fixed-price"} jobs are excluded by this profile`,
    extra,
  );
}

/** Returns the CURRENCY and BUDGET checks. Amounts are converted to the profile currency first. */
function checkBudget(job: NormalizedJob, config: ProfileConfig): HardCheckResult[] {
  const { budget } = config;
  const missingEffect = unknownEffect(budget.missingBudgetPolicy);
  const isFixed = job.budgetType === "FIXED";
  const isHourly = job.budgetType === "HOURLY";
  const minimum = isFixed ? budget.fixedMin : isHourly ? budget.hourlyMin : null;
  const maximum = isFixed ? budget.fixedMax : null;

  if (!minimum && !maximum) {
    return [
      notApplicable("CURRENCY", "No budget limits configured for this job type"),
      notApplicable("BUDGET", "No budget limits configured for this job type"),
    ];
  }

  // Conservative policy: a range is judged by its lower bound.
  const rawAmount = isFixed ? job.budgetAmount : job.hourlyMin;
  const amount = toCents(rawAmount);
  if (amount === null) {
    return [
      notApplicable("CURRENCY", "No amount to convert"),
      result("BUDGET", "UNKNOWN", missingEffect, "BUDGET_UNKNOWN", "Budget is not stated by the source", {
        expected: minimum ? `>= ${minimum} ${budget.currency}` : undefined,
      }),
    ];
  }

  const conversion = convertToProfileCurrency(amount, job.currency, config);
  if (!conversion.ok) {
    return [
      result("CURRENCY", "UNKNOWN", missingEffect, conversion.reasonCode, conversion.message, {
        observed: job.currency,
        expected: budget.currency,
      }),
      result("BUDGET", "UNKNOWN", missingEffect, "BUDGET_NOT_COMPARABLE", "Budget cannot be compared safely"),
    ];
  }

  const currencyCheck = pass("CURRENCY", conversion.message, {
    observed: job.currency,
    expected: budget.currency,
  });
  const comparable = conversion.cents;
  const observed = `${centsToString(comparable)} ${budget.currency}`;
  const unit = isHourly ? "/hr" : "";

  const minCents = toCents(minimum);
  if (minCents !== null && comparable < minCents) {
    return [
      currencyCheck,
      result(
        "BUDGET",
        "FAIL",
        "REJECT",
        "BUDGET_BELOW_MINIMUM",
        `Budget ${observed}${unit} is below minimum`,
        {
          observed,
          expected: `>= ${minimum} ${budget.currency}${unit}`,
        },
      ),
    ];
  }
  const maxCents = toCents(maximum);
  if (maxCents !== null && comparable > maxCents) {
    return [
      currencyCheck,
      result("BUDGET", "FAIL", "REJECT", "BUDGET_ABOVE_MAXIMUM", `Budget ${observed} is above maximum`, {
        observed,
        expected: `<= ${maximum} ${budget.currency}`,
      }),
    ];
  }
  return [currencyCheck, pass("BUDGET", `Budget ${observed}${unit} meets the requirement`, { observed })];
}

type Conversion =
  { ok: true; cents: Cents; message: string } | { ok: false; reasonCode: string; message: string };

function convertToProfileCurrency(amount: Cents, currency: string | null, config: ProfileConfig): Conversion {
  const target = config.budget.currency;
  if (!currency) return { ok: false, reasonCode: "CURRENCY_UNKNOWN", message: "Budget currency is unknown" };
  const from = currency.toUpperCase();
  if (from === target) return { ok: true, cents: amount, message: `Budget already in ${target}` };
  const policy = config.budget.currencyPolicy;
  const rate = policy.mode === "FIXED_RATES" ? policy.rates[from] : undefined;
  if (!rate) {
    return {
      ok: false,
      reasonCode: "CURRENCY_NOT_CONVERTIBLE",
      message: `No configured exchange rate from ${from} to ${target}`,
    };
  }
  const converted = convertCents(amount, rate);
  if (converted === null) {
    return { ok: false, reasonCode: "CURRENCY_RATE_INVALID", message: `Invalid exchange rate for ${from}` };
  }
  return { ok: true, cents: converted, message: `Converted ${from} to ${target} at configured rate ${rate}` };
}

function checkPaymentVerified(job: NormalizedJob, config: ProfileConfig): HardCheckResult {
  if (!config.client.paymentVerificationRequired) {
    return notApplicable("PAYMENT_VERIFIED", "Payment verification not required");
  }
  if (job.paymentVerified === true) return pass("PAYMENT_VERIFIED", "Client payment method is verified");
  // Strict requirement: UNKNOWN never passes, and it is never inferred from other client signals.
  return job.paymentVerified === false
    ? result("PAYMENT_VERIFIED", "FAIL", "REJECT", "PAYMENT_NOT_VERIFIED", "Client payment is not verified")
    : result(
        "PAYMENT_VERIFIED",
        "UNKNOWN",
        "REJECT",
        "PAYMENT_STATUS_UNKNOWN",
        "Client payment verification status is unknown",
      );
}

function checkClient(job: NormalizedJob, config: ProfileConfig): HardCheckResult[] {
  const { client } = config;
  const unknown = unknownEffect(client.unknownClientDataPolicy);
  const checks: HardCheckResult[] = [];

  if (client.minRating === null) {
    checks.push(notApplicable("CLIENT_RATING", "No minimum client rating"));
  } else if (job.clientRating === null) {
    checks.push(
      result("CLIENT_RATING", "UNKNOWN", unknown, "RATING_UNKNOWN", "Client rating is unavailable"),
    );
  } else {
    // Ratings have 2 decimals; compare in hundredths to avoid float issues.
    const observed = toCents(job.clientRating) ?? 0n;
    const ok = observed >= BigInt(Math.round(client.minRating * 100));
    checks.push(
      ok
        ? pass("CLIENT_RATING", `Client rating ${job.clientRating} meets minimum`)
        : result("CLIENT_RATING", "FAIL", "REJECT", "RATING_BELOW_MINIMUM", "Client rating below minimum", {
            observed: job.clientRating,
            expected: `>= ${client.minRating}`,
          }),
    );
  }

  if (client.minHires === null) {
    checks.push(notApplicable("CLIENT_HIRES", "No minimum hire history"));
  } else if (job.clientHires === null) {
    checks.push(
      result("CLIENT_HIRES", "UNKNOWN", unknown, "HIRES_UNKNOWN", "Client hire history is unavailable"),
    );
  } else {
    checks.push(
      job.clientHires >= client.minHires
        ? pass("CLIENT_HIRES", `Client has ${job.clientHires} hires`)
        : result(
            "CLIENT_HIRES",
            "FAIL",
            "REJECT",
            "HIRES_BELOW_MINIMUM",
            "Client hire history below minimum",
            {
              observed: job.clientHires,
              expected: `>= ${client.minHires}`,
            },
          ),
    );
  }

  if (client.minTotalSpent === null) {
    checks.push(notApplicable("CLIENT_SPEND", "No minimum client spend"));
  } else if (job.clientTotalSpent === null) {
    checks.push(
      result("CLIENT_SPEND", "UNKNOWN", unknown, "SPEND_UNKNOWN", "Client total spend is unavailable"),
    );
  } else {
    const ok = (toCents(job.clientTotalSpent) ?? 0n) >= (toCents(client.minTotalSpent) ?? 0n);
    checks.push(
      ok
        ? pass("CLIENT_SPEND", "Client spend meets minimum")
        : result(
            "CLIENT_SPEND",
            "FAIL",
            "REJECT",
            "SPEND_BELOW_MINIMUM",
            "Client total spend below minimum",
            {
              observed: job.clientTotalSpent,
              expected: `>= ${client.minTotalSpent}`,
            },
          ),
    );
  }

  const allowed = client.allowedCountries.map((c) => c.toLowerCase());
  const blocked = client.blockedCountries.map((c) => c.toLowerCase());
  if (allowed.length === 0 && blocked.length === 0) {
    checks.push(notApplicable("CLIENT_LOCATION", "No location restrictions"));
  } else if (!job.clientCountry) {
    checks.push(
      result("CLIENT_LOCATION", "UNKNOWN", unknown, "LOCATION_UNKNOWN", "Client location is unavailable"),
    );
  } else {
    const country = job.clientCountry.toLowerCase();
    const ok = (allowed.length === 0 || allowed.includes(country)) && !blocked.includes(country);
    checks.push(
      ok
        ? pass("CLIENT_LOCATION", `Client location ${job.clientCountry} allowed`)
        : result(
            "CLIENT_LOCATION",
            "FAIL",
            "REJECT",
            "LOCATION_NOT_ALLOWED",
            "Client location is not allowed",
            {
              observed: job.clientCountry,
            },
          ),
    );
  }
  return checks;
}

function checkCategory(job: NormalizedJob, config: ProfileConfig): HardCheckResult {
  const wanted = config.skills.category;
  if (!wanted) return notApplicable("CATEGORY", "No category restriction");
  if (!job.category)
    return result("CATEGORY", "UNKNOWN", "REVIEW", "CATEGORY_UNKNOWN", "Job category is unknown");
  return job.category.toLowerCase() === wanted.toLowerCase()
    ? pass("CATEGORY", "Category matches")
    : result("CATEGORY", "FAIL", "REJECT", "CATEGORY_MISMATCH", "Job category does not match", {
        observed: job.category,
        expected: wanted,
      });
}

function checkRequiredSkills(matches: TermMatch[], config: ProfileConfig): HardCheckResult {
  const { skills } = config;
  if (skills.required.length === 0) return notApplicable("REQUIRED_SKILLS", "No required skills");
  const strong = matches.filter((m) => m.strength === "STRONG").map((m) => m.term);
  const weak = matches.filter((m) => m.strength === "WEAK").map((m) => m.term);
  const needed =
    skills.requiredMatchMode === "ALL"
      ? skills.required.length
      : skills.requiredMatchMode === "AT_LEAST"
        ? skills.minRequiredMatches
        : 1;
  const observed = { strong, weakOnly: weak };
  if (strong.length >= needed) {
    return pass("REQUIRED_SKILLS", `Matched required skills: ${strong.join(", ")}`, { observed });
  }
  return result(
    "REQUIRED_SKILLS",
    "FAIL",
    "REJECT",
    weak.length > 0 ? "SKILLS_ONLY_INCIDENTAL" : "SKILLS_NOT_MATCHED",
    weak.length > 0
      ? `Required skills only mentioned incidentally (${weak.join(", ")})`
      : "No required skills matched",
    { observed, expected: `${needed} strong match(es)` },
  );
}

function checkIncludeKeywords(job: SearchableJob, config: ProfileConfig): HardCheckResult {
  const keywords = config.skills.includeKeywords;
  if (keywords.length === 0) return notApplicable("INCLUDE_KEYWORDS", "No include keywords");
  const found = keywords.filter((k) => containsTerm(job, k));
  return found.length > 0
    ? pass("INCLUDE_KEYWORDS", `Contains: ${found.join(", ")}`)
    : result(
        "INCLUDE_KEYWORDS",
        "FAIL",
        "REJECT",
        "NO_INCLUDE_KEYWORD",
        "None of the include keywords found",
      );
}

function checkExcludeKeywords(job: SearchableJob, config: ProfileConfig): HardCheckResult {
  const keywords = config.skills.excludeKeywords;
  if (keywords.length === 0) return notApplicable("EXCLUDE_KEYWORDS", "No exclude keywords");
  const found = keywords.filter((k) => containsTerm(job, k));
  return found.length === 0
    ? pass("EXCLUDE_KEYWORDS", "No excluded keywords found")
    : result(
        "EXCLUDE_KEYWORDS",
        "FAIL",
        "REJECT",
        "EXCLUDED_KEYWORD",
        `Contains excluded keyword: ${found.join(", ")}`,
        {
          observed: found,
        },
      );
}

function checkRequiredCombinations(job: SearchableJob, config: ProfileConfig): HardCheckResult {
  const combinations = config.skills.requiredCombinations;
  if (combinations.length === 0) return notApplicable("REQUIRED_COMBINATIONS", "No required combinations");
  const matched = combinations.find((combo) => combo.every((t) => containsTerm(job, t)));
  return matched
    ? pass("REQUIRED_COMBINATIONS", `Matched combination: ${matched.join(" + ")}`)
    : result(
        "REQUIRED_COMBINATIONS",
        "FAIL",
        "REJECT",
        "NO_COMBINATION_MATCHED",
        "No required keyword combination found",
      );
}

/** Share of the profile's search keywords present in the job, compared with the configured minimum. */
export function keywordCoverage(job: SearchableJob, keywords: string[]) {
  const found = keywords.filter((k) => containsTerm(job, k));
  const percent = keywords.length === 0 ? 0 : Math.floor((found.length * 100) / keywords.length);
  return { found, percent };
}

function checkKeywordCoverage(job: SearchableJob, config: ProfileConfig): HardCheckResult {
  const { keywords, keywordCoveragePercent: minimum } = config.search;
  if (minimum === null || keywords.length === 0) {
    return notApplicable("KEYWORD_COVERAGE", "No keyword coverage rule");
  }
  const { found, percent } = keywordCoverage(job, keywords);
  const observed = { percent, found };
  const expected = `at least ${minimum}% of ${keywords.length} keyword(s)`;
  return percent >= minimum
    ? pass("KEYWORD_COVERAGE", `Keyword coverage ${percent}% (${found.join(", ")})`, { observed, expected })
    : result(
        "KEYWORD_COVERAGE",
        "FAIL",
        "REJECT",
        "LOW_KEYWORD_COVERAGE",
        `Keyword coverage ${percent}% is below ${minimum}%`,
        { observed, expected },
      );
}

function checkNotPreviouslyNotified(config: ProfileConfig, context: HardCheckContext): HardCheckResult {
  if (enabledChannels(config).length === 0) {
    return notApplicable("NOT_PREVIOUSLY_NOTIFIED", "Notifications disabled for this profile");
  }
  return context.alreadyNotified
    ? result(
        "NOT_PREVIOUSLY_NOTIFIED",
        "FAIL",
        "REJECT",
        "ALREADY_NOTIFIED",
        "Already notified to this recipient",
      )
    : pass("NOT_PREVIOUSLY_NOTIFIED", "Not previously notified to this recipient");
}
