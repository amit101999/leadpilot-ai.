import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/runs/executor", () => ({ dispatchRun: vi.fn(async () => ({ ok: true })) }));

import { GET as importContext } from "@/app/api/import/context/route";
import { POST as commitJobs } from "@/app/api/import/jobs/route";
import { POST as screenJobs } from "@/app/api/import/jobs/screen/route";
import { POST as syncStatus } from "@/app/api/import/sync-status/route";
import { POST as revokeToken } from "@/app/api/import-tokens/[id]/revoke/route";
import { GET as listTokens, POST as createToken } from "@/app/api/import-tokens/route";
import { POST as createProfile } from "@/app/api/profiles/route";
import { POST as createRecipient } from "@/app/api/recipients/route";
import { POST as createRun } from "@/app/api/runs/route";
import { getDb } from "@/lib/database/client";
import { agentRuns, jobs, notifications, stagedJobs, syncState } from "@/lib/database/schema";
import type { MockEmailProvider } from "@/modules/notifications/mock-email";
import { defaultProfileConfig, type ProfileConfig } from "@/modules/profiles/config-schema";
import { getProviders } from "@/modules/providers";
import { runInProcess } from "@/modules/runs/engine";
import { call, createUser, type TestUser } from "./helpers";

const email = () => getProviders().email as MockEmailProvider;

/** An Upwork MCP search item, as the agent sends it (with the untrusted-content wrapper and utm link). */
function upworkJob(overrides: Record<string, unknown> = {}) {
  const id = `21177${Math.floor(Math.random() * 1e12)}`;
  return {
    id,
    title: "React and Node.js dashboard with Zoho CRM API integration",
    description:
      "<untrusted_participant_content>\nWe need a React and Node.js developer to build a dashboard that syncs deals from Zoho CRM through its REST API. Clear milestones.\n</untrusted_participant_content>",
    url: `https://www.upwork.com/jobs/~02${id}?utm_campaign=LLM_claude_MCP_jobpost&utm_source=claude`,
    job_type: "fixed",
    budget: "900.00",
    skills: ["React", "Node.js", "Zoho CRM"],
    experience_level: "intermediate",
    proposals_tier: "5 to 10",
    published_date: "2026-11-03T23:07:50.332Z",
    client: {
      country: "United States",
      rating: 4.81,
      total_posted_jobs: 197,
      total_reviews: 88,
      total_spent: "$23,575.22",
      verification_status: "VERIFIED",
    },
    ...overrides,
  };
}

const details = (hires: number) => ({
  client_record: { contracts_total: hires, hire_rate_percent: 70, jobs_posted: 197, open_jobs: 5, spend_total: "$23,575.22" },
  data: {
    marketplaceJobPosting: {
      classification: { category: { preferredLabel: "Web, Mobile & Software Dev" } },
      contractTerms: { contractType: "FIXED", fixedPriceContractTerms: { amount: { currency: "USD", rawValue: "900.0" } } },
      activityStat: { jobActivity: { totalHired: 0, invitesSent: 1 } },
    },
  },
  client_feedback: { reviews: [{ comment: "should never be stored" }] },
});

async function newToken(user: TestUser) {
  const res = await call(createToken, { method: "POST", user, body: { name: "Upwork sync" } });
  expect(res.status).toBe(201);
  return { id: res.json.data.id as string, bearer: { authorization: `Bearer ${res.json.data.token as string}` } };
}

async function newProfile(user: TestUser, mutate?: (c: ProfileConfig) => void) {
  const config = defaultProfileConfig(null);
  config.ai.minScore = 0; // relevance is not under test here; every job passing the rules qualifies
  config.search.upworkSync.enabled = true;
  mutate?.(config);
  const res = await call(createProfile, {
    method: "POST",
    user,
    body: { name: `Import ${randomUUID().slice(0, 6)}`, configuration: config },
  });
  expect(res.status).toBe(200);
  return res.json.data.id as string;
}

function commit(headers: Record<string, string>, profileId: string, list: unknown[]) {
  return call(commitJobs, { method: "POST", headers, body: { profileId, origin: "upwork-mcp", jobs: list } });
}

async function execute(runId: string) {
  await runInProcess(getDb(), getProviders(), runId, { sleep: async () => {} });
}

beforeEach(() => email().reset());

describe("import tokens", () => {
  it("shows a token once, lists it without the secret, and rejects it after revocation", async () => {
    const user = await createUser("OPERATOR");
    const token = await newToken(user);
    const list = await call(listTokens, { user });
    expect(JSON.stringify(list.json)).not.toContain("lpi_");

    expect((await call(importContext, { headers: token.bearer })).status).toBe(200);
    expect((await call(importContext, {})).status).toBe(401);
    expect((await call(importContext, { headers: { authorization: "Bearer lpi_wrong" } })).status).toBe(401);

    await call(revokeToken, { method: "POST", user, params: { id: token.id } });
    expect((await call(importContext, { headers: token.bearer })).status).toBe(401);
  });

  it("cannot import into another user's profile, and VIEWERs cannot create tokens", async () => {
    const owner = await createUser("OPERATOR");
    const other = await createUser("OPERATOR");
    const profileId = await newProfile(owner);
    const token = await newToken(other);
    expect((await commit(token.bearer, profileId, [upworkJob()])).status).toBe(404);
    const viewer = await createUser("VIEWER");
    expect((await call(createToken, { method: "POST", user: viewer, body: { name: "x" } })).status).toBe(403);
  });
});

describe("import flow", () => {
  it("screens without storing and asks for details only for jobs that pass the rules", async () => {
    const user = await createUser("OPERATOR");
    const profileId = await newProfile(user);
    const token = await newToken(user);
    const good = upworkJob();
    const cheap = upworkJob({ budget: "100.00" });
    const res = await call(screenJobs, {
      method: "POST",
      headers: token.bearer,
      body: { profileId, origin: "upwork-mcp", jobs: [good, cheap, { title: "no id" }] },
    });
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ received: 3, valid: 2, rejected: 1, detailsWanted: [good.id] });
    expect(res.json.data.invalid).toHaveLength(1);
    const staged = await getDb().select().from(stagedJobs).where(eq(stagedJobs.profileId, profileId));
    expect(staged).toHaveLength(0);
  });

  it("commits, runs on the imported jobs, and maps Upwork data without the tracking link or wrapper", async () => {
    const user = await createUser("OPERATOR");
    const profileId = await newProfile(user);
    const token = await newToken(user);
    const job = { ...upworkJob(), details: details(151) };
    const res = await commit(token.bearer, profileId, [job]);
    expect(res.status).toBe(202);
    expect(res.json.data).toMatchObject({ status: "STARTED", accepted: 1 });
    const runId = res.json.data.runId as string;

    const [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, runId));
    expect(run!.sourceProvider).toBe("upwork-import");
    await execute(runId);

    const [stored] = await getDb()
      .select()
      .from(jobs)
      .where(and(eq(jobs.source, "upwork"), eq(jobs.sourceJobId, job.id)));
    expect(stored!.jobUrl).toBe(`https://www.upwork.com/jobs/~02${job.id}`);
    expect(stored!.description).not.toContain("untrusted_participant_content");
    expect(stored).toMatchObject({ paymentVerified: true, clientHires: 151, clientTotalSpent: "23575.22", budgetAmount: "900.00" });
    expect(JSON.stringify(stored!.sourceMetadata)).not.toContain("should never be stored");

    const [finished] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, runId));
    expect(["COMPLETED", "COMPLETED_WITH_ERRORS"]).toContain(finished!.status);
    expect(finished!.qualifiedCount).toBe(1);
    const consumed = await getDb().select().from(stagedJobs).where(eq(stagedJobs.consumedRunId, runId));
    expect(consumed).toHaveLength(1);
  });

  it("stores a re-imported job once, updates it, and keeps details fetched earlier", async () => {
    const user = await createUser("OPERATOR");
    const profileId = await newProfile(user);
    const token = await newToken(user);
    const job = upworkJob();
    const first = await commit(token.bearer, profileId, [{ ...job, details: details(42) }]);
    await execute(first.json.data.runId);
    const second = await commit(token.bearer, profileId, [{ ...job, budget: "1200.00" }]);
    await execute(second.json.data.runId);

    const rows = await getDb()
      .select()
      .from(jobs)
      .where(and(eq(jobs.source, "upwork"), eq(jobs.sourceJobId, job.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ budgetAmount: "1200.00", clientHires: 42 });
  });

  it("queues jobs imported during an active run and starts a follow-up run when it finishes", async () => {
    const user = await createUser("OPERATOR");
    const profileId = await newProfile(user);
    const token = await newToken(user);
    // A manual run (configured mock source) is active when the import arrives.
    const manual = await call(createRun, {
      method: "POST",
      user,
      body: { profileId },
      headers: { "idempotency-key": randomUUID() },
    });
    const queued = await commit(token.bearer, profileId, [upworkJob()]);
    expect(queued.json.data).toMatchObject({ status: "QUEUED", runId: null });

    await execute(manual.json.data.id);
    const runs = await getDb().select().from(agentRuns).where(eq(agentRuns.profileId, profileId));
    expect(runs).toHaveLength(2);
    const followUp = runs.find((r) => r.id !== manual.json.data.id)!;
    expect(followUp).toMatchObject({
      idempotencyKey: `follow-up:${manual.json.data.id}`,
      sourceProvider: "upwork-import",
      requestedBy: user.id,
    });
    await execute(followUp.id);
    const pending = await getDb()
      .select()
      .from(stagedJobs)
      .where(and(eq(stagedJobs.profileId, profileId), eq(stagedJobs.status, "PENDING")));
    expect(pending).toHaveLength(0);
  });

  it("e-mails a qualified imported job once, never again on a later import", async () => {
    const user = await createUser("OPERATOR");
    const recipient = await call(createRecipient, {
      method: "POST",
      user,
      body: { channel: "EMAIL", label: "Me", email: "Me@Example.com", optInConfirmed: true },
    });
    expect(recipient.status).toBe(200);
    expect(recipient.json.data.emailMasked).toBe("m•••@example.com");
    const profileId = await newProfile(user, (c) => {
      c.notifications.emailEnabled = true;
      c.notifications.emailRecipientId = recipient.json.data.id;
    });
    const token = await newToken(user);
    const job = upworkJob();
    const first = await commit(token.bearer, profileId, [job]);
    await execute(first.json.data.runId);
    expect(email().sent).toHaveLength(1);
    expect(email().sent[0]!.subject).toContain("React and Node.js dashboard");

    const again = await commit(token.bearer, profileId, [job]);
    await execute(again.json.data.runId);
    expect(email().sent).toHaveLength(1);
    const claims = await getDb()
      .select()
      .from(notifications)
      .where(eq(notifications.recipientId, recipient.json.data.id));
    expect(claims).toHaveLength(1);
    expect(claims[0]!.channel).toBe("EMAIL");
  });
});

describe("sync schedule", () => {
  it("records sync status, and scheduled syncs get nothing while they are not allowed", async () => {
    const user = await createUser("OPERATOR");
    const profileId = await newProfile(user);
    const token = await newToken(user);

    const manual = await call(importContext, { headers: token.bearer, path: "/api/import/context?scheduled=false" });
    expect(manual.json.data.profiles.find((p: { id: string }) => p.id === profileId)).toMatchObject({ due: true });
    const scheduled = await call(importContext, { headers: token.bearer, path: "/api/import/context?scheduled=true" });
    expect(scheduled.json.data.scheduledAllowed).toBe(false);
    expect(scheduled.json.data.profiles.every((p: { due: boolean }) => !p.due)).toBe(true);

    const res = await call(syncStatus, {
      method: "POST",
      headers: token.bearer,
      body: { profileId, status: "ERROR", message: "Upwork said 403 for token sk-abcdefghijklmnop" },
    });
    expect(res.status).toBe(200);
    const [state] = await getDb().select().from(syncState).where(eq(syncState.profileId, profileId));
    expect(state!.lastStatus).toBe("ERROR");
    expect(state!.lastError).not.toContain("sk-abcdefghijklmnop");
  });
});
