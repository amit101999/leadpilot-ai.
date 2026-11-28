import { describe, expect, it } from "vitest";
import type { AiUsage } from "@/modules/ai/evaluator";
import { estimateCostMicroUsd, priceFor } from "@/modules/ai/pricing";
import { AiProviderError } from "@/modules/ai/evaluator";
import { statusForError } from "@/modules/ai/usage-ledger";

const usage = (over: Partial<AiUsage> = {}): AiUsage => ({
  model: "gpt-6.1-sol",
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  ...over,
});

describe("estimateCostMicroUsd", () => {
  it("prices uncached input, cached input and output at their own rates", () => {
    // gpt-6.1-sol: $2.00 in, $0.10 cached, $10.00 out per 1M tokens.
    // 900k uncached = $1.80, 100k cached = $0.01, 50k out = $0.50 → $2.31
    const cost = estimateCostMicroUsd(
      usage({ inputTokens: 1_000_000, cachedInputTokens: 100_000, outputTokens: 50_000 }),
    );
    expect(cost).toBe(2_310_000n);
  });

  it("does not bill reasoning tokens twice (they are part of output tokens)", () => {
    const withReasoning = estimateCostMicroUsd(usage({ outputTokens: 1000, reasoningTokens: 800 }));
    const without = estimateCostMicroUsd(usage({ outputTokens: 1000 }));
    expect(withReasoning).toBe(without);
  });

  it("rounds down to a whole micro-dollar", () => {
    // 1 input token on gpt-6-luna = $0.10/1M = 0.1 micro-USD → 0
    expect(estimateCostMicroUsd(usage({ model: "gpt-6-luna", inputTokens: 1 }))).toBe(0n);
    expect(estimateCostMicroUsd(usage({ model: "gpt-6-luna", inputTokens: 10 }))).toBe(1n);
  });

  it("never treats more cached tokens than input tokens as a negative uncached count", () => {
    const cost = estimateCostMicroUsd(usage({ inputTokens: 100, cachedInputTokens: 500 }));
    expect(cost).toBe(10n); // 100 tokens at the cached $0.10/1M
  });

  it("returns null for a model with no known price instead of zero", () => {
    expect(estimateCostMicroUsd(usage({ model: "some-unlisted-model", inputTokens: 5000 }))).toBeNull();
  });

  it("prices the production model gpt-4o-mini, including its dated snapshot", () => {
    // $0.15 in, $0.075 cached, $0.60 out per 1M: 900k uncached + 100k cached + 50k out = $0.135 + $0.0075 + $0.03
    const cost = estimateCostMicroUsd(
      usage({
        model: "gpt-4o-mini-2024-07-18",
        inputTokens: 1_000_000,
        cachedInputTokens: 100_000,
        outputTokens: 50_000,
      }),
    );
    expect(cost).toBe(172_500n);
  });
});

describe("priceFor", () => {
  it("bills dated snapshots like their base model, case-insensitively", () => {
    expect(priceFor("GPT-6.1-sol-2026-05-01")).toEqual(priceFor("gpt-6.1-sol"));
    expect(priceFor("gpt-6.1-sol")).not.toBeNull();
  });

  it("does not confuse similarly named models", () => {
    expect(priceFor("gpt-6-astra")).not.toEqual(priceFor("gpt-6.2-astra"));
    expect(priceFor("gpt-6.1-sol-healthcare")).toBeNull();
  });
});

describe("statusForError", () => {
  it("maps provider error kinds to call statuses and keeps the HTTP status", () => {
    expect(statusForError(new AiProviderError("t", "TIMEOUT"))).toEqual({
      status: "TIMEOUT",
      httpStatus: null,
    });
    expect(statusForError(new AiProviderError("r", "RATE_LIMIT", 429))).toEqual({
      status: "RATE_LIMIT",
      httpStatus: 429,
    });
    expect(statusForError(new AiProviderError("p", "PROVIDER", 500))).toEqual({
      status: "PROVIDER_ERROR",
      httpStatus: 500,
    });
    expect(statusForError(new Error("unexpected"))).toEqual({ status: "PROVIDER_ERROR", httpStatus: null });
  });
});
