import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/runs/executor", () => ({ dispatchRun: vi.fn(async () => ({ ok: true })) }));

import { GET as listNotifications } from "@/app/api/notifications/route";
import { POST as retry } from "@/app/api/notifications/[id]/retry/route";
import { POST as createProfile } from "@/app/api/profiles/route";
import { POST as createRecipient } from "@/app/api/recipients/route";
import { GET as runNotifications } from "@/app/api/runs/[id]/notifications/route";
import { POST as createRun } from "@/app/api/runs/route";
import { getDb } from "@/lib/database/client";
import { agentRuns, notifications } from "@/lib/database/schema";
import { defaultProfileConfig } from "@/modules/profiles/config-schema";
import { MockJobSourceProvider } from "@/modules/job-sources/mock-provider";
import type { MockEmailProvider } from "@/modules/notifications/mock-email";
import { getProviders, setProvidersForTesting } from "@/modules/providers";
import { runInProcess } from "@/modules/runs/engine";
import { call, createUser, type TestUser } from "./helpers";

const ADDRESS = "alerts-me@example.com";
const email = () => getProviders().email as MockEmailProvider;
const isSummary = (m: { idempotencyKey: string }) => m.idempotencyKey.startsWith("summary-");
/** Lead alerts only; run summaries (alertOnFailure / sendRunSummary) are separate e-mails. */
const leadMessages = () => email().sent.filter((m) => !isSummary(m));

async function setup(user: TestUser, maxPerRun = 10, sendRunSummary = false) {
  const recipient = await call(createRecipient, {
    method: "POST",
    user,
    body: { label: "Me", email: ADDRESS, optInConfirmed: true },
  });
  const recipientId = recipient.json.data.id as string;
  return { recipientId, profileId: await addProfile(user, recipientId, maxPerRun, sendRunSummary) };
}

async function addProfile(user: TestUser, recipientId: string, maxPerRun: number, sendRunSummary = false) {
  const config = defaultProfileConfig(recipientId);
  config.notifications.maxPerRun = maxPerRun;
  config.notifications.sendRunSummary = sendRunSummary;
  const profile = await call(createProfile, {
    method: "POST",
    user,
    body: { name: `P ${randomUUID().slice(0, 6)}`, configuration: config },
  });
  return profile.json.data.id as string;
}

/** Switches the job source to one of the scripted mock feeds (src/modules/job-sources/mock-fixtures.ts). */
function useScenario(scenario: string) {
  setProvidersForTesting({ ...getProviders(), jobSource: new MockJobSourceProvider(scenario) });
}

async function createRunFor(user: TestUser, profileId: string) {
  const run = await call(createRun, {
    method: "POST",
    user,
    body: { profileId },
    headers: { "idempotency-key": randomUUID() },
  });
  return run.json.data.id as string;
}

async function executeRun(user: TestUser, profileId: string) {
  const runId = await createRunFor(user, profileId);
  await runInProcess(getDb(), getProviders(), runId, { sleep: async () => {} });
  return runId;
}

beforeEach(() => email().reset());
afterEach(() => setProvidersForTesting(undefined));

describe("notifications", () => {
  it("sends qualified leads once, never to the same recipient again on a rerun (acceptance #7)", async () => {
    const user = await createUser("OPERATOR");
    const { profileId } = await setup(user);
    const firstRun = await executeRun(user, profileId);
    const first = await call(runNotifications, { user, params: { id: firstRun } });
    expect(first.status).toBe(200);
    const sent = first.json.data.filter((n: { status: string }) => n.status === "SENT");
    expect(sent.length).toBeGreaterThan(0);
    expect(JSON.stringify(first.json)).not.toContain(ADDRESS);

    const secondRun = await executeRun(user, profileId);
    const second = await call(runNotifications, { user, params: { id: secondRun } });
    expect(second.json.data).toHaveLength(0);
    expect(leadMessages()).toHaveLength(sent.length);
  });

  it("never sends more than the per-run limit (acceptance #8)", async () => {
    const user = await createUser("OPERATOR");
    const { profileId } = await setup(user, 2);
    const runId = await executeRun(user, profileId);
    const list = await call(runNotifications, { user, params: { id: runId } });
    expect(list.json.data.length).toBeLessThanOrEqual(2);
    expect(leadMessages().length).toBeLessThanOrEqual(2);
    // The limit covers lead alerts only; a failure summary (alertOnFailure) is a separate e-mail.
    const summaries = email().sent.filter(isSummary);
    expect(summaries.length).toBeLessThanOrEqual(1);
  });

  it("reserves exactly the limit when more leads qualify: 15 eligible, limit 10, 10 sent", async () => {
    useScenario("bulk-qualified");
    const user = await createUser("OPERATOR");
    const { profileId } = await setup(user, 10);
    const runId = await executeRun(user, profileId);
    const [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, runId));
    expect(run!.qualifiedCount).toBe(15);
    const list = (await call(runNotifications, { user, params: { id: runId } })).json.data;
    expect(list.filter((n: { status: string }) => n.status === "SENT")).toHaveLength(10);
    expect(leadMessages()).toHaveLength(10);
  });

  it("sends every lead when fewer qualify than the limit: 3 eligible, limit 10, 3 sent", async () => {
    useScenario("three-qualified");
    const user = await createUser("OPERATOR");
    const { profileId } = await setup(user, 10);
    const runId = await executeRun(user, profileId);
    const list = (await call(runNotifications, { user, params: { id: runId } })).json.data;
    expect(list.filter((n: { status: string }) => n.status === "SENT")).toHaveLength(3);
    expect(leadMessages()).toHaveLength(3);
  });

  it("never alerts the same job twice when two runs for one recipient execute concurrently", async () => {
    useScenario("bulk-qualified");
    const user = await createUser("OPERATOR");
    const { recipientId, profileId } = await setup(user, 10);
    const otherProfileId = await addProfile(user, recipientId, 10);
    const [runA, runB] = await Promise.all([
      createRunFor(user, profileId),
      createRunFor(user, otherProfileId),
    ]);
    await Promise.all(
      [runA, runB].map((id) => runInProcess(getDb(), getProviders(), id, { sleep: async () => {} })),
    );

    const rows = await getDb()
      .select({ runId: notifications.runId, jobId: notifications.jobId })
      .from(notifications)
      .where(eq(notifications.recipientId, recipientId));
    const jobIds = rows.map((r) => r.jobId);
    expect(new Set(jobIds).size).toBe(jobIds.length);
    for (const id of [runA, runB]) expect(rows.filter((r) => r.runId === id).length).toBeLessThanOrEqual(10);
    // Which run wins each job depends on timing; the guarantees are "at most once per job" and the limits.
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.length).toBeLessThanOrEqual(15);
    const previews = leadMessages().map((m) => m.text);
    expect(new Set(previews).size).toBe(previews.length);

    const runs = await getDb()
      .select()
      .from(agentRuns)
      .where(inArray(agentRuns.id, [runA, runB]));
    for (const run of runs) expect(["COMPLETED", "COMPLETED_WITH_ERRORS"]).toContain(run.status);
  });

  it("keeps the qualification when a send fails and allows a manual retry (acceptance #11)", async () => {
    const user = await createUser("OPERATOR");
    const { profileId } = await setup(user, 1);
    email().queueOutcome({
      kind: "rejected",
      retryable: false,
      httpStatus: null,
      error: "550 Mailbox unavailable",
    });
    const runId = await executeRun(user, profileId);
    const [failed] = (await call(runNotifications, { user, params: { id: runId } })).json.data;
    expect(failed.status).toBe("FAILED_PERMANENT");

    const res = await call(retry, { method: "POST", user, params: { id: failed.id }, body: {} });
    expect(res.status).toBe(200);
    expect(res.json.data.status).toBe("SENT");

    const again = await call(retry, { method: "POST", user, params: { id: failed.id }, body: {} });
    expect(again.status).toBe(409);
  });

  it("does not retry an uncertain send early or without confirmation (acceptance #16)", async () => {
    const user = await createUser("OPERATOR");
    const { profileId } = await setup(user, 1);
    email().queueOutcome({ kind: "uncertain", error: "timeout" });
    const runId = await executeRun(user, profileId);
    const [uncertain] = (await call(runNotifications, { user, params: { id: runId } })).json.data;
    expect(uncertain.status).toBe("UNCERTAIN");

    const early = await call(retry, {
      method: "POST",
      user,
      params: { id: uncertain.id },
      body: { confirmNotReceived: true },
    });
    expect(early.status).toBe(409);
    expect(early.json.error.details.retryAfterSeconds).toBeGreaterThan(0);

    await getDb()
      .update(notifications)
      .set({ lastAttemptAt: new Date(Date.now() - 20 * 60_000) })
      .where(eq(notifications.id, uncertain.id));
    const unconfirmed = await call(retry, { method: "POST", user, params: { id: uncertain.id }, body: {} });
    expect(unconfirmed.status).toBe(400);

    const confirmed = await call(retry, {
      method: "POST",
      user,
      params: { id: uncertain.id },
      body: { confirmNotReceived: true },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.data.status).toBe("SENT");
  });

  it("hides other users' notifications and blocks VIEWER retries", async () => {
    const owner = await createUser("OPERATOR");
    const other = await createUser("OPERATOR");
    const viewer = await createUser("VIEWER");
    const { profileId } = await setup(owner, 1);
    await executeRun(owner, profileId);
    const list = await call(listNotifications, { user: other });
    expect(list.json.meta.total).toBe(0);
    const [mine] = (await call(listNotifications, { user: owner })).json.data;
    expect(
      (await call(retry, { method: "POST", user: other, params: { id: mine.id }, body: {} })).status,
    ).toBe(404);
    expect(
      (await call(retry, { method: "POST", user: viewer, params: { id: mine.id }, body: {} })).status,
    ).toBe(403);
  });
});

describe("run summary e-mail", () => {
  it("e-mails one summary per run to the profile's e-mail recipient when enabled", async () => {
    const user = await createUser("OPERATOR");
    const { profileId } = await setup(user, 1, true);
    const runId = await executeRun(user, profileId);
    const summaries = email().sent.filter(isSummary);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.idempotencyKey).toBe(`summary-${runId}`);
    expect(summaries[0]!.subject).toMatch(/^LeadPilot run /);
    expect(summaries[0]!.text).toContain(`/history/${runId}`);
    const [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, runId));
    expect(run!.summaryNotification).toMatchObject({ status: "SENT" });
  });
});

describe("removed WhatsApp alerts", () => {
  it("refuses new WhatsApp recipients", async () => {
    const user = await createUser("OPERATOR");
    const res = await call(createRecipient, {
      method: "POST",
      user,
      body: { channel: "WHATSAPP", label: "Phone", phoneE164: "+14155550123", optInConfirmed: true },
    });
    expect(res.status).toBe(400);
  });
});
