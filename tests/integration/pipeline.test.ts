import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/runs/executor", () => ({ dispatchRun: vi.fn(async () => ({ ok: true })) }));

import { POST as createProfile } from "@/app/api/profiles/route";
import { POST as createRun } from "@/app/api/runs/route";
import { getDb } from "@/lib/database/client";
import { agentRuns, jobs, runJobs, runStages } from "@/lib/database/schema";
import type { MockSourceRecord } from "@/modules/job-sources/mock-fixtures";
import { MockJobSourceProvider } from "@/modules/job-sources/mock-provider";
import { defaultProfileConfig } from "@/modules/profiles/config-schema";
import { getProviders, setProvidersForTesting } from "@/modules/providers";
import { runInProcess } from "@/modules/runs/engine";
import { call, createUser, type TestUser } from "./helpers";

/** Runs the pipeline against the given job source instead of the default mock feed. */
function useSource(jobSource: MockJobSourceProvider) {
  setProvidersForTesting({ ...getProviders(), jobSource });
}

afterEach(() => setProvidersForTesting(undefined));

async function newProfile(user: TestUser) {
  const res = await call(createProfile, {
    method: "POST",
    user,
    body: { name: `Profile ${randomUUID().slice(0, 6)}`, configuration: defaultProfileConfig(null) },
  });
  return res.json.data.id as string;
}

async function executeRun(user: TestUser, profileId: string) {
  const run = await call(createRun, {
    method: "POST",
    user,
    body: { profileId },
    headers: { "idempotency-key": randomUUID() },
  });
  expect(run.status).toBe(201);
  const runId = run.json.data.id as string;
  await runInProcess(getDb(), getProviders(), runId, { sleep: async () => {} });
  return runId;
}

function record(id: string): MockSourceRecord {
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
  };
}

describe("run pipeline", () => {
  it("blocks the run when the job source is not authorized, without discovering anything", async () => {
    useSource(new MockJobSourceProvider("unauthorized"));
    const user = await createUser("OPERATOR");
    const runId = await executeRun(user, await newProfile(user));

    const [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, runId));
    expect(run!.status).toBe("BLOCKED_SOURCE");
    expect(run!.errorSummary).toMatchObject({ code: "SOURCE_NOT_AUTHORIZED" });
    expect(run!.sourceCount).toBe(0);

    const stages = await getDb().select().from(runStages).where(eq(runStages.runId, runId));
    const status = Object.fromEntries(stages.map((s) => [s.stage, s.status]));
    expect(status.SOURCE_CHECK).toBe("FAILED");
    expect(status.DISCOVERY).toBe("SKIPPED");
    expect(status.NOTIFICATION).toBe("SKIPPED");
  });

  it("deduplicates jobs within a run and across runs, and skips records it cannot normalize", async () => {
    const prefix = randomUUID().slice(0, 8);
    const a = record(`${prefix}-a`);
    const b = record(`${prefix}-b`);
    // a is delivered twice in the same feed; the last record has no id.
    useSource(new MockJobSourceProvider("custom", [a, b, { ...a }, { title: "No id", body: "x" }]));
    const user = await createUser("OPERATOR");
    const profileId = await newProfile(user);

    const first = await executeRun(user, profileId);
    const [discovery] = await getDb()
      .select()
      .from(runStages)
      .where(and(eq(runStages.runId, first), eq(runStages.stage, "DISCOVERY")));
    expect(discovery!.metrics).toMatchObject({ received: 4, linked: 2, duplicatesInRun: 1, invalid: 1 });
    const [firstRun] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, first));
    expect(firstRun!.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "INVALID_SOURCE_RECORDS" })]),
    );

    const second = await executeRun(user, profileId);
    const stored = await getDb().select({ id: jobs.id, sourceJobId: jobs.sourceJobId }).from(jobs);
    expect(stored.filter((j) => j.sourceJobId.startsWith(prefix))).toHaveLength(2);

    const links = await getDb().select().from(runJobs).where(eq(runJobs.runId, second));
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.previouslySeen)).toBe(true);
  });
});
