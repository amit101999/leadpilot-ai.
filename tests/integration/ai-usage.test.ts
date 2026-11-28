import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/runs/executor", () => ({ dispatchRun: vi.fn(async () => ({ ok: true })) }));

import { POST as createProfile } from "@/app/api/profiles/route";
import { POST as createRun } from "@/app/api/runs/route";
import { getDb } from "@/lib/database/client";
import { aiCalls, jobs } from "@/lib/database/schema";
import type { MockSourceRecord } from "../fakes/mock-fixtures";
import { getAiUsage } from "@/modules/ai-usage/service";
import { MockJobSourceProvider } from "../fakes/mock-job-source";
import { defaultProfileConfig } from "@/modules/profiles/config-schema";
import { getProviders, setProvidersForTesting } from "@/modules/providers";
import { runInProcess } from "@/modules/runs/engine";
import { call, createUser } from "./helpers";

afterEach(() => setProvidersForTesting(undefined));

function record(id: string, mockAi: MockSourceRecord["mockAi"]): MockSourceRecord {
  return {
    id,
    title: `React and Node.js integration ${id}`,
    body: "Build React screens and Node.js API integrations for an internal tool with clear milestones.",
    link: `https://example.com/mock-jobs/${id}`,
    engagement: "fixed",
    amount: { value: "900", currency: "USD" },
    client: { verified: true, rating: 4.9, hires: 10, spent: "20000", country: "United States" },
    tags: ["React", "Node.js"],
    posted: "2026-10-01T09:00:00Z",
    mockAi,
  };
}

async function callsFor(sourceJobId: string) {
  return getDb()
    .select({ call: aiCalls })
    .from(aiCalls)
    .innerJoin(jobs, eq(jobs.id, aiCalls.jobId))
    .where(eq(jobs.sourceJobId, sourceJobId))
    .orderBy(asc(aiCalls.attempt))
    .then((rows) => rows.map((r) => r.call));
}

describe("AI usage ledger", () => {
  it("records one row per model attempt, including retries and failures", async () => {
    const tag = randomUUID().slice(0, 6);
    const ids = { ok: `ok-${tag}`, retry: `retry-${tag}`, slow: `slow-${tag}`, bad: `bad-${tag}` };
    setProvidersForTesting({
      ...getProviders(),
      jobSource: new MockJobSourceProvider("custom", [
        record(ids.ok, { dimensions: { skill_alignment: 90 } }),
        record(ids.retry, { behavior: "invalid-once" }),
        record(ids.slow, { behavior: "timeout" }),
        record(ids.bad, { behavior: "invalid" }),
      ]),
    });

    const user = await createUser("OPERATOR");
    const profile = await call(createProfile, {
      method: "POST",
      user,
      body: { name: `Usage ${tag}`, configuration: defaultProfileConfig(null) },
    });
    const profileId = profile.json.data.id as string;
    const run = await call(createRun, {
      method: "POST",
      user,
      body: { profileId },
      headers: { "idempotency-key": randomUUID() },
    });
    expect(run.status).toBe(201);
    const runId = run.json.data.id as string;
    await runInProcess(getDb(), getProviders(), runId, { sleep: async () => {} });

    const statuses = async (id: string) => (await callsFor(id)).map((c) => [c.attempt, c.status]);
    expect(await statuses(ids.ok)).toEqual([[1, "SUCCESS"]]);
    expect(await statuses(ids.retry)).toEqual([
      [1, "INVALID_OUTPUT"],
      [2, "SUCCESS"],
    ]);
    // Default profile allows 2 retries → 3 attempts.
    expect(await statuses(ids.slow)).toEqual([
      [1, "TIMEOUT"],
      [2, "TIMEOUT"],
      [3, "TIMEOUT"],
    ]);
    expect(await statuses(ids.bad)).toEqual([
      [1, "INVALID_OUTPUT"],
      [2, "INVALID_OUTPUT"],
      [3, "INVALID_OUTPUT"],
    ]);

    const [first] = await callsFor(ids.ok);
    expect(first).toMatchObject({
      runId,
      profileId,
      provider: "mock",
      model: "mock-evaluator-v1",
      inputTokens: null, // the mock reports no usage, so no fake spend is recorded
      costMicroUsd: null,
    });
    expect(first!.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("AI usage read model", () => {
  async function profileOf(user: Awaited<ReturnType<typeof createUser>>) {
    const res = await call(createProfile, {
      method: "POST",
      user,
      body: { name: `Spend ${randomUUID().slice(0, 6)}`, configuration: defaultProfileConfig(null) },
    });
    return res.json.data.id as string;
  }

  const row = (profileId: string, over: Partial<typeof aiCalls.$inferInsert> = {}) => ({
    profileId,
    provider: "openai",
    model: "gpt-6.1-sol",
    promptVersion: "v2",
    attempt: 1,
    status: "SUCCESS" as const,
    latencyMs: 100,
    inputTokens: 1000,
    cachedInputTokens: 0,
    outputTokens: 100,
    reasoningTokens: 0,
    costMicroUsd: 3000n,
    ...over,
  });

  it("sums tokens and cost, excludes mock calls, and scopes non-admins to their own profiles", async () => {
    const owner = await createUser("OPERATOR");
    const other = await createUser("OPERATOR");
    const admin = await createUser("ADMIN");
    const mine = await profileOf(owner);
    const theirs = await profileOf(other);
    await getDb()
      .insert(aiCalls)
      .values([
        row(mine, { latencyMs: 100 }),
        row(mine, {
          latencyMs: 300,
          status: "TIMEOUT",
          inputTokens: null,
          outputTokens: null,
          costMicroUsd: null,
        }),
        row(mine, { model: "some-unlisted-model", costMicroUsd: null }), // tokens but no known price
        row(mine, { provider: "mock", costMicroUsd: 999_999n }), // never counted
        row(theirs, { costMicroUsd: 50_000n }),
      ]);

    const usage = await getAiUsage(getDb(), owner, "30");
    expect(usage.totals).toMatchObject({
      calls: 3,
      failed: 1,
      inputTokens: 2000,
      outputTokens: 200,
      costMicroUsd: 3000n,
      unpricedCalls: 1,
    });
    expect(usage.byModel.map((m) => m.model).sort()).toEqual(["gpt-6.1-sol", "some-unlisted-model"]);
    expect(usage.daily).toHaveLength(30);
    expect(usage.daily.at(-1)?.costMicroUsd).toBe(3000n);
    expect(usage.recent).toHaveLength(3);

    // The other operator sees only their own spend; the admin sees everyone's real calls.
    expect((await getAiUsage(getDb(), other, "30")).totals.costMicroUsd).toBe(50_000n);
    const all = await getAiUsage(getDb(), admin, "30");
    expect(all.totals.calls).toBeGreaterThanOrEqual(4);
    expect(all.recent.every((c) => c.model !== "mock-evaluator-v1")).toBe(true);
  });

  it("denies viewers", async () => {
    const viewer = await createUser("VIEWER");
    await expect(getAiUsage(getDb(), viewer, "30")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
