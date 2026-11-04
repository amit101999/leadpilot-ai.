import { formatMoney } from "@/lib/ui/format";
import type { ProfileConfig } from "./config-schema";

export interface ConfigChange {
  path: string;
  label: string;
  before: string;
  after: string;
}

/** Human labels for every configurable field, in display order. */
const LABELS: Array<[string, string]> = [
  ["general.maxJobsToEvaluate", "Jobs evaluated per run"],
  ["skills.required", "Required skills"],
  ["skills.requiredMatchMode", "Required skill match"],
  ["skills.minRequiredMatches", "Minimum required matches"],
  ["skills.optional", "Optional skills"],
  ["skills.includeKeywords", "Include keywords"],
  ["skills.excludeKeywords", "Exclude keywords"],
  ["skills.requiredCombinations", "Required combinations"],
  ["skills.category", "Category"],
  ["budget.jobType", "Job type"],
  ["budget.fixedMin", "Minimum budget"],
  ["budget.fixedMax", "Maximum budget"],
  ["budget.hourlyMin", "Minimum hourly rate"],
  ["budget.currency", "Currency"],
  ["budget.currencyPolicy.mode", "Other currencies"],
  ["budget.currencyPolicy.rates", "Exchange rates"],
  ["budget.missingBudgetPolicy", "Missing budget"],
  ["client.paymentVerificationRequired", "Payment verification"],
  ["client.minRating", "Minimum client rating"],
  ["client.minHires", "Minimum client hires"],
  ["client.minTotalSpent", "Minimum client spend"],
  ["client.allowedCountries", "Allowed client countries"],
  ["client.blockedCountries", "Blocked client countries"],
  ["client.unknownClientDataPolicy", "Unknown client data"],
  ["ai.minScore", "Minimum AI score"],
  ["ai.weights.skillAlignment", "Weight: skill alignment"],
  ["ai.weights.scopeFit", "Weight: scope fit"],
  ["ai.weights.descriptionClarity", "Weight: description clarity"],
  ["ai.weights.clientCredibility", "Weight: client credibility"],
  ["ai.weights.overallRelevance", "Weight: overall relevance"],
  ["ai.riskSensitivity", "Risk sensitivity"],
  ["ai.disqualifyingRiskFlags", "Disqualifying risk flags"],
  ["ai.maxRetries", "AI retries on invalid output"],
  ["notifications.whatsappEnabled", "WhatsApp alerts"],
  ["notifications.recipientId", "Alert recipient"],
  ["notifications.emailEnabled", "E-mail alerts"],
  ["notifications.emailRecipientId", "E-mail recipient"],
  ["search.keywords", "Search keywords"],
  ["search.keywordCoveragePercent", "Keyword coverage required (%)"],
  ["search.upworkSync.enabled", "Upwork sync"],
  ["search.upworkSync.everyHours", "Sync every (hours)"],
  ["search.upworkSync.activeFrom", "Sync active from"],
  ["search.upworkSync.activeTo", "Sync active until"],
  ["search.upworkSync.timezone", "Sync time zone"],
  ["notifications.maxPerRun", "Maximum alerts per run"],
  ["notifications.messageFormat", "Message format"],
  ["notifications.sendRunSummary", "Run summary message"],
  ["notifications.alertOnFailure", "Failure alert"],
];

const ENUM_TEXT: Record<string, string> = {
  FIXED: "Fixed-price only",
  HOURLY: "Hourly only",
  BOTH: "Fixed-price and hourly",
  ANY: "At least one",
  ALL: "All of them",
  AT_LEAST: "At least N",
  SAME_CURRENCY_ONLY: "Same currency only",
  FIXED_RATES: "Convert with fixed rates",
  FAIL: "Reject",
  NEEDS_REVIEW: "Send to review",
  IGNORE: "Ignore",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  STANDARD: "Standard",
  COMPACT: "Compact",
};

function get(config: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value === null || value === undefined || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, config);
}

const MONEY_PATHS = new Set([
  "budget.fixedMin",
  "budget.fixedMax",
  "budget.hourlyMin",
  "client.minTotalSpent",
]);

/** Readable text for one field value (used for both sides of a change). */
export function describeValue(
  path: string,
  value: unknown,
  recipientName?: (id: string) => string,
  currency?: string,
): string {
  if (value === null || value === undefined || value === "") return "None";
  if (path === "notifications.recipientId" || path === "notifications.emailRecipientId") {
    return recipientName?.(String(value)) ?? "Selected recipient";
  }
  if (MONEY_PATHS.has(path)) return formatMoney(String(value), currency ?? "USD");
  if (typeof value === "boolean") {
    if (path === "client.paymentVerificationRequired") return value ? "Required" : "Not required";
    return value ? "On" : "Off";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    return value
      .map((item) => {
        if (Array.isArray(item)) return item.join(" + ");
        if (item && typeof item === "object" && "name" in item) {
          const skill = item as { name: string; aliases?: string[] };
          return skill.aliases?.length ? `${skill.name} (${skill.aliases.join(", ")})` : skill.name;
        }
        return String(item);
      })
      .join(", ");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length ? entries.map(([k, v]) => `1 ${k} = ${String(v)}`).join(", ") : "None";
  }
  const text = String(value);
  return ENUM_TEXT[text] ?? text;
}

/**
 * Field-by-field differences between two configurations, in the order the
 * editor shows them. Only changed fields are returned.
 */
export function diffConfigs(
  before: ProfileConfig,
  after: ProfileConfig,
  recipientName?: (id: string) => string,
): ConfigChange[] {
  const changes: ConfigChange[] = [];
  for (const [path, label] of LABELS) {
    const a = get(before, path);
    const b = get(after, path);
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    changes.push({
      path,
      label,
      before: describeValue(path, a, recipientName, before.budget.currency),
      after: describeValue(path, b, recipientName, after.budget.currency),
    });
  }
  return changes;
}
