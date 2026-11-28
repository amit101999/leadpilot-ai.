import { describe, expect, it, vi } from "vitest";
import type { DbExecutor } from "@/lib/database/client";
import type { childLogger } from "@/lib/logging/logger";
import { recordAiCall, type AiCallRecord } from "@/modules/ai/usage-ledger";

const base: AiCallRecord = {
  runId: null,
  jobId: "job-1",
  profileId: null,
  provider: "openai",
  configuredModel: "gpt-6.1-sol",
  promptVersion: "v2",
  attempt: 1,
  status: "SUCCESS",
  httpStatus: null,
  latencyMs: 12.6,
  usage: {
    model: "gpt-6.1-sol-2026-05-01",
    inputTokens: 1000,
    cachedInputTokens: 0,
    outputTokens: 100,
    reasoningTokens: 0,
  },
};

function fakeDb(values: (row: unknown) => Promise<void>) {
  return { insert: () => ({ values }) } as unknown as DbExecutor;
}

const fakeLog = () =>
  ({ warn: vi.fn() }) as unknown as ReturnType<typeof childLogger> & { warn: ReturnType<typeof vi.fn> };

describe("recordAiCall", () => {
  it("stores the reported snapshot, rounded latency and estimated cost", async () => {
    const values = vi.fn(async () => {});
    await recordAiCall(fakeDb(values), base, fakeLog());
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-6.1-sol-2026-05-01",
        latencyMs: 13,
        inputTokens: 1000,
        outputTokens: 100,
        costMicroUsd: 3000n, // 1000 × $2/1M + 100 × $10/1M = $0.003
      }),
    );
  });

  it("falls back to the configured model and no cost when no usage was reported", async () => {
    const values = vi.fn(async () => {});
    await recordAiCall(fakeDb(values), { ...base, status: "TIMEOUT", usage: null }, fakeLog());
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-6.1-sol", inputTokens: null, costMicroUsd: null }),
    );
  });

  it("never throws when the insert fails, and logs a warning instead", async () => {
    const log = fakeLog();
    const db = fakeDb(async () => {
      throw new Error("connection lost");
    });
    await expect(recordAiCall(db, base, log)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
