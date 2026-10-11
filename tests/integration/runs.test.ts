import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// The real dispatcher schedules work with next/server `after()`, which needs a
// live request scope. Tests drive execution explicitly with runInProcess.
vi.mock("@/modules/runs/executor", () => ({ dispatchRun: vi.fn(async () => ({ ok: true })) }));

import { GET as getJob } from "@/app/api/jobs/[id]/route";
import { GET as listJobs } from "@/app/api/jobs/route";
import { GET as listLeads } from "@/app/api/leads/route";
import { POST as createProfile } from "@/app/api/profiles/route";
import { PATCH as patchProfile } from "@/app/api/profiles/[id]/route";
import { POST as cancelRun } from "@/app/api/runs/[id]/cancel/route";
import { GET as runEvents } from "@/app/api/runs/[id]/events/route";
import { GET as runJobs } from "@/app/api/runs/[id]/jobs/route";
import { GET as getRun } from "@/app/api/runs/[id]/route";
import { GET as listRuns, POST as createRun } from "@/app/api/runs/route";
import { getDb } from "@/lib/database/client";
import { defaultProfileConfig } from "@/modules/profiles/config-schema";
import { getProviders } from "@/modules/providers";
import { runInProcess } from "@/modules/runs/engine";
import { call, createUser, type TestUser } from "./helpers";

async function newProfile(user: TestUser) {
  const res = await call(createProfile, {
    method: "POST",
    user,
    body: { name: `Profile ${randomUUID().slice(0, 6)}`, configuration: defaultProfileConfig(null) },
  });
  return res.json.data as { id: string };
}

function startRun(user: TestUser, profileId: string, key = randomUUID()) {
  return call(createRun, { method: "POST", user, body: { profileId }, headers: { "idempotency-key": key } });
}

describe("runs API", () => {
  it("requires an Idempotency-Key header", async () => {
    const user = await createUser("OPERATOR");
    const profile = await newProfile(user);
    const res = await call(createRun, { method: "POST", user, body: { profileId: profile.id } });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("returns the original run for a repeated key and blocks a second active run", async () => {
    const user = await createUser("OPERATOR");
    const profile = await newProfile(user);
    const key = randomUUID();
    const first = await startRun(user, profile.id, key);
    expect(first.status).toBe(201);
    expect(first.json.data.status).toBe("QUEUED");

    const repeat = await startRun(user, profile.id, key);
    expect(repeat.status).toBe(200);
    expect(repeat.json.data.id).toBe(first.json.data.id);

    const second = await startRun(user, profile.id);
    expect(second.status).toBe(409);
    expect(second.json.error.code).toBe("RUN_ALREADY_ACTIVE");
  });

  it("creates exactly one run when the same request is double-submitted concurrently", async () => {
    const user = await createUser("OPERATOR");
    const profile = await newProfile(user);
    const key = randomUUID();
    const results = await Promise.all([startRun(user, profile.id, key), startRun(user, profile.id, key)]);
    const ids = new Set(results.map((r) => r.json.data?.id));
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(ids.size).toBe(1);
  });

  it("keeps the run's configuration snapshot when the profile is edited later (acceptance #13, #14)", async () => {
    const user = await createUser("OPERATOR");
    const profile = await newProfile(user);
    const run = await startRun(user, profile.id);

    const config = defaultProfileConfig(null);
    config.budget.fixedMin = "900.00";
    await call(patchProfile, {
      method: "PATCH",
      user,
      params: { id: profile.id },
      body: { expectedVersion: 1, configuration: config },
    });

    const detail = await call(getRun, { user, params: { id: run.json.data.id } });
    const snapshot = detail.json.data.configurationSnapshot;
    expect(snapshot.profile.versionNumber).toBe(1);
    expect(JSON.stringify(snapshot)).toContain('"fixedMin":"500.00"');
    expect(JSON.stringify(snapshot)).not.toContain('"fixedMin":"900.00"');
  });

  it("cancels a queued run", async () => {
    const user = await createUser("OPERATOR");
    const profile = await newProfile(user);
    const run = await startRun(user, profile.id);
    const res = await call(cancelRun, { method: "POST", user, params: { id: run.json.data.id } });
    expect(res.status).toBe(200);
    expect(res.json.data.status).toBe("CANCELLED");
  });

  it("returns 404 for another user's run and VIEWERs cannot start runs (acceptance #17)", async () => {
    const owner = await createUser("OPERATOR");
    const other = await createUser("OPERATOR");
    const viewer = await createUser("VIEWER");
    const profile = await newProfile(owner);
    const run = await startRun(owner, profile.id);

    expect((await call(getRun, { user: other, params: { id: run.json.data.id } })).status).toBe(404);
    expect((await call(runEvents, { user: other, params: { id: run.json.data.id } })).status).toBe(404);
    expect((await startRun(viewer, profile.id)).status).toBe(403);
  });

  it("lists runs with pagination metadata and validates filters", async () => {
    const user = await createUser("OPERATOR");
    const profile = await newProfile(user);
    await startRun(user, profile.id);
    const list = await call(listRuns, { user, path: `/api/runs?profileId=${profile.id}&pageSize=10` });
    expect(list.status).toBe(200);
    expect(list.json.meta).toMatchObject({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
    expect(list.json.data[0]).not.toHaveProperty("configurationSnapshot");

    const bad = await call(listRuns, { user, path: "/api/runs?status=NOT_A_STATUS" });
    expect(bad.status).toBe(400);
  });

  it("runs end to end on the mock source and exposes results through the jobs and leads APIs", async () => {
    const user = await createUser("OPERATOR");
    const profile = await newProfile(user);
    const run = await startRun(user, profile.id);
    const runId = run.json.data.id as string;

    const final = await runInProcess(getDb(), getProviders(), runId, { sleep: async () => {} });
    expect(final.terminal).toBe(true);

    const events = await call(runEvents, { user, params: { id: runId } });
    expect(events.json.data.terminal).toBe(true);
    expect(["COMPLETED", "COMPLETED_WITH_ERRORS"]).toContain(events.json.data.run.status);
    expect(events.json.data.run).not.toHaveProperty("configurationSnapshot");
    expect(events.json.data.counters.sourceCount).toBeGreaterThan(0);

    const jobs = await call(listJobs, { user, path: `/api/jobs?profileId=${profile.id}&pageSize=100` });
    expect(jobs.status).toBe(200);
    expect(jobs.json.meta.total).toBe(events.json.data.counters.sourceCount);
    const filtered = jobs.json.data.filter(
      (j: { processingStatus: string }) => j.processingStatus === "FILTERED_OUT",
    );
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((j: { rejectionReasons: unknown[] }) => j.rejectionReasons.length > 0)).toBe(true);

    const leads = await call(listLeads, {
      user,
      path: `/api/leads?profileId=${profile.id}&decision=QUALIFIED`,
    });
    expect(leads.status).toBe(200);
    expect(leads.json.data.length).toBeGreaterThan(0);
    for (const lead of leads.json.data as Array<{
      score: number;
      budgetType: string;
      paymentVerified: boolean;
    }>) {
      expect(lead.score).toBeGreaterThanOrEqual(75);
      expect(lead.budgetType).toBe("FIXED");
      expect(lead.paymentVerified).toBe(true);
    }

    const perRun = await call(runJobs, { user, params: { id: runId } });
    expect(perRun.status).toBe(200);
    const anyJob = jobs.json.data[0] as { id: string };
    const detail = await call(getJob, { user, params: { id: anyJob.id } });
    expect(detail.status).toBe(200);
    expect(detail.json.data.job.id).toBe(anyJob.id);

    const outsider = await createUser("OPERATOR");
    expect((await call(getJob, { user: outsider, params: { id: anyJob.id } })).status).toBe(404);
  });
});
