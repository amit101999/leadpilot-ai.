import type { AiUsage } from "./evaluator";

/**
 * Estimated OpenAI cost per call, computed from reported token counts.
 *
 * Prices are micro-USD per one million tokens, i.e. the published "$ per 1M
 * tokens" figure times 1,000,000, kept as bigint so no float ever touches money
 * (same rule as src/lib/money/decimal.ts). Standard processing tier only.
 *
 * Source: https://developers.openai.com/api/docs/pricing and
 * https://openai.com/api/pricing/, checked 2026-11-28. When OpenAI changes a
 * price, update this table: rows already stored keep the cost computed when
 * the call was made. A model missing here gets a NULL cost (shown as
 * "no price") rather than a misleading $0.
 */
interface ModelPrice {
  input: bigint;
  cachedInput: bigint;
  output: bigint;
}

const usd = (dollarsPerMillion: string): bigint => {
  const [whole = "0", fraction = ""] = dollarsPerMillion.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
};

const PRICES: Record<string, ModelPrice> = {
  "gpt-6.2-astra": { input: usd("8.00"), cachedInput: usd("0.40"), output: usd("40.00") },
  "gpt-6.2-sol": { input: usd("2.00"), cachedInput: usd("0.10"), output: usd("10.00") },
  "gpt-6-astra": { input: usd("10.00"), cachedInput: usd("1.00"), output: usd("50.00") },
  "gpt-6.1-sol": { input: usd("2.00"), cachedInput: usd("0.10"), output: usd("10.00") },
  "gpt-6.1-terra": { input: usd("1.00"), cachedInput: usd("0.05"), output: usd("5.00") },
  "gpt-6-luna": { input: usd("0.10"), cachedInput: usd("0.01"), output: usd("0.50") },
  // Deprecated by OpenAI but still served; the production model as of 2026-11-28
  // (https://developers.openai.com/api/docs/models/gpt-4o-mini).
  "gpt-4o-mini": { input: usd("0.15"), cachedInput: usd("0.075"), output: usd("0.60") },
};

/** Dated snapshots ("gpt-6.1-sol-2026-05-01") are billed like their base model. */
const SNAPSHOT_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;

export function priceFor(model: string): ModelPrice | null {
  const id = model.trim().toLowerCase();
  return PRICES[id] ?? PRICES[id.replace(SNAPSHOT_SUFFIX, "")] ?? null;
}

/**
 * Cost of one call in micro-USD, rounded down to a whole micro-dollar, or null
 * when the model has no known price. Reasoning tokens are already counted in
 * outputTokens, and cached tokens are a subset of inputTokens.
 */
export function estimateCostMicroUsd(usage: AiUsage): bigint | null {
  const price = priceFor(usage.model);
  if (!price) return null;
  const cached = BigInt(Math.min(usage.cachedInputTokens, usage.inputTokens));
  const uncached = BigInt(usage.inputTokens) - cached;
  const total =
    uncached * price.input + cached * price.cachedInput + BigInt(usage.outputTokens) * price.output;
  return total / 1_000_000n;
}
