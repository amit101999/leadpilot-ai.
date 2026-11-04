import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/runs/executor", () => ({ dispatchRun: vi.fn(async () => ({ ok: true })) }));

process.env.INTERNAL_API_SECRET = "test-internal-secret-0123456789";

import { GET as auditLogs } from "@/app/api/audit-logs/route";
import { GET as dashboard } from "@/app/api/dashboard/route";
import { GET as leadsCsv } from "@/app/api/exports/leads.csv/route";
import { GET as runsCsv } from "@/app/api/exports/runs.csv/route";
import { POST as checkIntegration } from "@/app/api/integrations/[provider]/check/route";
import { POST as testMessage } from "@/app/api/integrations/[provider]/test/route";
import { GET as integrationStatus } from "@/app/api/integrations/status/route";
import { POST as failStep } from "@/app/api/internal/runs/[id]/fail/route";
import { POST as runStepRoute } from "@/app/api/internal/runs/[id]/steps/[step]/route";
import { POST as createProfile } from "@/app/api/profiles/route";
import { POST as createRecipient } from "@/app/api/recipients/route";
import { GET as getRun } from "@/app/api/runs/[id]/route";
import { POST as createRun } from "@/app/api/runs/route";
import { getDb } from "@/lib/database/client";
import {
  agentRuns,
  auditLogs as auditTable,
  integrationStatus as integrationStatusTable,
  jobs,
} from "@/lib/database/schema";
import { signPayload, SIGNATURE_HEADER } from "@/lib/security/hmac";
import { defaultProfileConfig } from "@/modules/profiles/config-schema";
import { getProviders } from "@/modules/providers";
import { runInProcess } from "@/modules/runs/engine";
import { call, createUser, type TestUser } from "./helpers";

async function newRun(user: TestUser) {
  const profile = await call(createProfile, {
    method: "POST",
    user,
    body: { name: `P ${randomUUID().slice(0, 6)}`, configuration: defaultProfileConfig(null) },
  });
  const run = await call(createRun, {
    method: "POST",
    user,
    body: { profileId: profile.json.data.id },
    headers: { "idempotency-key": randomUUID() },
  });
  return run.json.data.id as string;
}

function internalCall(handler: Parameters<typeof call>[0], params: Record<string, string>, body: unknown) {
  const raw = JSON.stringify(body);
  return call(handler, {
    method: "POST",
    origin: null,
    params,
    body,
    headers: { [SIGNATURE_HEADER]: signPayload(process.env.INTERNAL_API_SECRET!, raw) },
  });
}

describe("integrations", () => {
  it("returns stored status without calling anything, then stores a live check", async () => {
    const user = await createUser("OPERATOR");
    const before = await call(integrationStatus, { user });
    expect(before.json.data.map((s: { name: string }) => s.name)).toEqual([
      "database",
      "job_source",
      "ai",
      "whatsapp",
      "email",
      "n8n",
    ]);
    expect(
      before.json.data.every((s: { status: unknown; stale: boolean }) => s.status === null && s.stale),
    ).toBe(true);

    const expected: Record<string, string> = {
      database: "CONNECTED",
      job_source: "MOCK",
      ai: "MOCK",
      whatsapp: "MOCK",
      n8n: "NOT_CONFIGURED",
    };
    for (const [name, state] of Object.entries(expected)) {
      const res = await call(checkIntegration, { method: "POST", user, params: { provider: name } });
      expect(res.status).toBe(200);
      expect(res.json.data.status).toBe(state);
      expect(res.json.data.stale).toBe(false);
    }
    const after = await call(integrationStatus, { user });
    expect(JSON.stringify(after.json)).not.toMatch(/secret|token|password/i);
  });

  it("records the job source check from every run with a message and a fresh last-success time", async () => {
    const user = await createUser("OPERATOR");
    const firstRun = await newRun(user);
    await runInProcess(getDb(), getProviders(), firstRun, { sleep: async () => {} });
    const [first] = await getDb()
      .select()
      .from(integrationStatusTable)
      .where(eq(integrationStatusTable.provider, "job_source"));
    expect(first!.status).toBe("MOCK");
    expect((first!.metadata as { message?: string }).message).toMatch(/Mock job source/);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondRun = await newRun(user);
    await runInProcess(getDb(), getProviders(), secondRun, { sleep: async () => {} });
    const [second] = await getDb()
      .select()
      .from(integrationStatusTable)
      .where(eq(integrationStatusTable.provider, "job_source"));
    // Regression: the update branch used to leave last_success_at at the first run's time.
    expect(second!.lastSuccessAt!.getTime()).toBeGreaterThan(first!.lastSuccessAt!.getTime());
    expect(second!.lastSuccessAt!.getTime()).toBe(second!.lastCheckedAt!.getTime());
  });

  it("rejects unknown integrations and VIEWER checks", async () => {
    const operator = await createUser("OPERATOR");
    const viewer = await createUser("VIEWER");
    expect(
      (
        await call(checkIntegration, {
          method: "POST",
          user: operator,
          params: { provider: "upwork-scraper" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await call(checkIntegration, { method: "POST", user: viewer, params: { provider: "database" } }))
        .status,
    ).toBe(403);
  });

  it("sends a WhatsApp test only to an opted-in recipient and audits it", async () => {
    const user = await createUser("OPERATOR");
    const pending = await call(createRecipient, {
      method: "POST",
      user,
      body: { label: "Not opted in", phoneE164: "+14155550100", optInConfirmed: false },
    });
    const blocked = await call(testMessage, {
      method: "POST",
      user,
      params: { provider: "whatsapp" },
      body: { recipientId: pending.json.data.id },
    });
    expect(blocked.status).toBe(409);

    const ok = await call(createRecipient, {
      method: "POST",
      user,
      body: { label: "Opted in", phoneE164: "+14155550101", optInConfirmed: true },
    });
    const sent = await call(testMessage, {
      method: "POST",
      user,
      params: { provider: "whatsapp" },
      body: { recipientId: ok.json.data.id },
    });
    expect(sent.status).toBe(200);
    expect(sent.json.data).toMatchObject({ status: "ACCEPTED", isMock: true });
    const audit = await getDb().select().from(auditTable).where(eq(auditTable.entityId, ok.json.data.id));
    expect(audit.some((a) => a.action === "whatsapp.test_message")).toBe(true);

    const wrongProvider = await call(testMessage, {
      method: "POST",
      user,
      params: { provider: "ai" },
      body: { recipientId: ok.json.data.id },
    });
    expect(wrongProvider.status).toBe(404);
  });
});

describe("dashboard, exports and audit", () => {
  it("reports real totals for the user's own runs only", async () => {
    const user = await createUser("OPERATOR");
    const runId = await newRun(user);
    await runInProcess(getDb(), getProviders(), runId, { sleep: async () => {} });

    const mine = await call(dashboard, { user });
    expect(mine.status).toBe(200);
    expect(mine.json.data.totals.runs).toBe(1);
    expect(mine.json.data.totals.jobsDiscovered).toBeGreaterThan(0);
    expect(mine.json.data.totals.uniqueJobsDiscovered).toBeGreaterThan(0);
    expect(mine.json.data.daily).toHaveLength(30);
    expect(mine.json.data.daily.at(-1).runs).toBe(1);
    expect(mine.json.data.daily[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mine.json.data.integrations).toHaveLength(6);

    const stranger = await createUser("OPERATOR");
    const theirs = await call(dashboard, { user: stranger });
    expect(theirs.json.data.totals.runs).toBe(0);
    expect(theirs.json.data.recentRuns).toHaveLength(0);
  });

  it("exports CSV with the same filters, a truncation flag and formula-injection protection", async () => {
    const user = await createUser("OPERATOR");
    const runId = await newRun(user);
    await runInProcess(getDb(), getProviders(), runId, { sleep: async () => {} });
    // Simulate a hostile job title arriving from a source.
    await getDb().update(jobs).set({ title: '=HYPERLINK("http://evil")' });

    const res = await leadsCsv(
      new (await import("next/server")).NextRequest(
        "http://localhost:3000/api/exports/leads.csv?decision=QUALIFIED",
        {
          headers: { cookie: user.cookie },
        },
      ),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("x-export-truncated")).toBe("false");
    const text = await res.text();
    expect(text.split("\r\n")[0]).toContain("Job title");
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(text).toContain("'=HYPERLINK");

    const runs = await runsCsv(
      new (await import("next/server")).NextRequest("http://localhost:3000/api/exports/runs.csv", {
        headers: { cookie: user.cookie },
      }),
      { params: Promise.resolve({}) },
    );
    expect(runs.status).toBe(200);
    expect(Number(runs.headers.get("x-export-rows"))).toBe(1);
  });

  it("restricts the audit log to ADMINs", async () => {
    const admin = await createUser("ADMIN");
    const operator = await createUser("OPERATOR");
    await newRun(operator);
    expect((await call(auditLogs, { user: operator })).status).toBe(403);
    const res = await call(auditLogs, { user: admin, path: "/api/audit-logs?action=run.create" });
    expect(res.status).toBe(200);
    expect(res.json.data.length).toBeGreaterThan(0);
    expect(res.json.data.every((e: { action: string }) => e.action === "run.create")).toBe(true);
  });
});

describe("internal n8n endpoints", () => {
  it("rejects unsigned calls", async () => {
    const user = await createUser("OPERATOR");
    const runId = await newRun(user);
    const res = await call(runStepRoute, {
      method: "POST",
      origin: null,
      params: { id: runId, step: "start" },
      body: { executionId: "exec-1" },
    });
    expect(res.status).toBe(401);
  });

  it("drives a run to completion one signed step at a time", async () => {
    const user = await createUser("OPERATOR");
    const runId = await newRun(user);
    let step = "start";
    let last: { terminal: boolean; next: string | null; retryAfterMs?: number } | null = null;
    for (let i = 0; i < 200 && step; i++) {
      const res = await internalCall(runStepRoute, { id: runId, step }, { executionId: "exec-42" });
      expect(res.status).toBe(200);
      last = res.json.data;
      if (last!.terminal || !last!.next) break;
      step = last!.next;
    }
    expect(last?.terminal).toBe(true);
    const run = await call(getRun, { user, params: { id: runId } });
    expect(["COMPLETED", "COMPLETED_WITH_ERRORS"]).toContain(run.json.data.status);
  });

  it("does not let a duplicate execution fail a run another execution is driving", async () => {
    const user = await createUser("OPERATOR");
    const runId = await newRun(user);
    const owner = await internalCall(runStepRoute, { id: runId, step: "start" }, { executionId: "exec-A" });
    expect(owner.status).toBe(200);

    const duplicate = await internalCall(
      runStepRoute,
      { id: runId, step: "start" },
      { executionId: "exec-B" },
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.json.error.code).toBe("LEASE_HELD");

    for (const executionId of ["exec-B", undefined]) {
      const res = await internalCall(failStep, { id: runId }, { error: "lease held", executionId });
      expect(res.status).toBe(409);
    }
    const stillRunning = await call(getRun, { user, params: { id: runId } });
    expect(stillRunning.json.data.status).not.toBe("FAILED");

    const own = await internalCall(failStep, { id: runId }, { error: "own failure", executionId: "exec-A" });
    expect(own.status).toBe(200);
    expect(own.json.data.status).toBe("FAILED");
  });

  it("lets any execution fail a run once the previous lease has expired", async () => {
    const user = await createUser("OPERATOR");
    const runId = await newRun(user);
    await internalCall(runStepRoute, { id: runId, step: "start" }, { executionId: "exec-A" });
    await getDb()
      .update(agentRuns)
      .set({ leaseExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(agentRuns.id, runId));
    const res = await internalCall(failStep, { id: runId }, { error: "crashed", executionId: "exec-B" });
    expect(res.status).toBe(200);
    expect(res.json.data.status).toBe("FAILED");
  });

  it("marks a run FAILED from the error workflow and sanitises the message", async () => {
    const user = await createUser("OPERATOR");
    const runId = await newRun(user);
    const res = await internalCall(
      failStep,
      { id: runId },
      {
        stage: "DISCOVERY",
        error: "Upstream failed: Bearer sk-live-abcdefghijklmnop",
        executionId: "exec-7",
      },
    );
    expect(res.status).toBe(200);
    expect(res.json.data.status).toBe("FAILED");
    const run = await call(getRun, { user, params: { id: runId } });
    expect(run.json.data.errorSummary.code).toBe("WORKFLOW_EXECUTION_FAILED");
    expect(JSON.stringify(run.json.data.errorSummary)).not.toContain("sk-live-abcdefghijklmnop");
  });
});
