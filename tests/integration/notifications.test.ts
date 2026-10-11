import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/runs/executor", () => ({ dispatchRun: vi.fn(async () => ({ ok: true })) }));

process.env.WHATSAPP_APP_SECRET = "test-app-secret";
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "test-verify-token";

import { GET as listNotifications } from "@/app/api/notifications/route";
import { POST as retry } from "@/app/api/notifications/[id]/retry/route";
import { POST as createProfile } from "@/app/api/profiles/route";
import { POST as createRecipient } from "@/app/api/recipients/route";
import { GET as runNotifications } from "@/app/api/runs/[id]/notifications/route";
import { POST as createRun } from "@/app/api/runs/route";
import { GET as verifyWebhook, POST as webhook } from "@/app/api/webhooks/whatsapp/route";
import { getDb } from "@/lib/database/client";
import { auditLogs, notifications } from "@/lib/database/schema";
import { createHmac } from "node:crypto";
import { defaultProfileConfig } from "@/modules/profiles/config-schema";
import type { MockWhatsAppProvider } from "@/modules/notifications/mock-whatsapp";
import { getProviders } from "@/modules/providers";
import { runInProcess } from "@/modules/runs/engine";
import { call, createUser, type TestUser } from "./helpers";

const PHONE = "+14155550123";
const whatsapp = () => getProviders().whatsapp as MockWhatsAppProvider;
/** Lead alerts only; run summaries (alertOnFailure / sendRunSummary) are separate messages. */
const leadMessages = () => whatsapp().sent.filter((m) => m.kind === "lead");

async function setup(user: TestUser, maxPerRun = 10) {
  const recipient = await call(createRecipient, {
    method: "POST",
    user,
    body: { label: "Me", phoneE164: PHONE, optInConfirmed: true },
  });
  const config = defaultProfileConfig(recipient.json.data.id);
  config.notifications.maxPerRun = maxPerRun;
  const profile = await call(createProfile, {
    method: "POST",
    user,
    body: { name: `P ${randomUUID().slice(0, 6)}`, configuration: config },
  });
  return { profileId: profile.json.data.id as string };
}

async function executeRun(user: TestUser, profileId: string) {
  const run = await call(createRun, {
    method: "POST",
    user,
    body: { profileId },
    headers: { "idempotency-key": randomUUID() },
  });
  await runInProcess(getDb(), getProviders(), run.json.data.id, { sleep: async () => {} });
  return run.json.data.id as string;
}

function signedWebhook(body: unknown, secret = "test-app-secret") {
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return { raw, signature };
}

async function postWebhook(body: unknown, signature?: string) {
  const signed = signedWebhook(body);
  return call(webhook, {
    method: "POST",
    origin: null,
    body,
    headers: { "x-hub-signature-256": signature ?? signed.signature },
  });
}

function statusPayload(statuses: unknown[]) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field: "messages", value: { statuses } }] }],
  };
}

beforeEach(() => whatsapp().reset());

describe("notifications", () => {
  it("sends qualified leads once, never to the same recipient again on a rerun (acceptance #7)", async () => {
    const user = await createUser("OPERATOR");
    const { profileId } = await setup(user);
    const firstRun = await executeRun(user, profileId);
    const first = await call(runNotifications, { user, params: { id: firstRun } });
    expect(first.status).toBe(200);
    const sent = first.json.data.filter((n: { status: string }) => n.status === "SENT");
    expect(sent.length).toBeGreaterThan(0);
    expect(JSON.stringify(first.json)).not.toContain(PHONE);

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
    // The limit covers lead alerts only; a failure summary (alertOnFailure) is a separate message.
    const summaries = whatsapp().sent.filter((m) => m.kind === "summary");
    expect(summaries.length).toBeLessThanOrEqual(1);
  });

  it("keeps the qualification when a send fails and allows a manual retry (acceptance #11)", async () => {
    const user = await createUser("OPERATOR");
    const { profileId } = await setup(user, 1);
    whatsapp().queueOutcome({
      kind: "rejected",
      retryable: false,
      httpStatus: 400,
      error: "Template rejected",
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
    whatsapp().queueOutcome({ kind: "uncertain", error: "timeout" });
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

describe("WhatsApp status webhook", () => {
  it("advances SENT -> DELIVERED -> READ and ignores backwards or unknown updates", async () => {
    const user = await createUser("OPERATOR");
    const { profileId } = await setup(user, 1);
    const runId = await executeRun(user, profileId);
    const [n] = (await call(runNotifications, { user, params: { id: runId } })).json.data;
    const wamid = n.providerMessageId as string;

    const res = await postWebhook(
      statusPayload([
        { id: wamid, status: "delivered", timestamp: "1750030080" },
        { id: wamid, status: "read", timestamp: "1750030090" },
        { id: wamid, status: "sent", timestamp: "1750030095" },
        { id: "wamid.unknown", status: "delivered" },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({ received: 4, applied: 2, ignored: 2 });
    const [row] = await getDb().select().from(notifications).where(eq(notifications.id, n.id));
    expect(row!.status).toBe("READ");
    expect(row!.deliveredAt).not.toBeNull();
  });

  it("reconciles an UNCERTAIN send through biz_opaque_callback_data", async () => {
    const user = await createUser("OPERATOR");
    const { profileId } = await setup(user, 1);
    whatsapp().queueOutcome({ kind: "uncertain", error: "timeout" });
    const runId = await executeRun(user, profileId);
    const [n] = (await call(runNotifications, { user, params: { id: runId } })).json.data;
    const [row] = await getDb().select().from(notifications).where(eq(notifications.id, n.id));
    expect(row!.status).toBe("UNCERTAIN");

    await postWebhook(
      statusPayload([
        { id: "wamid.recovered", status: "sent", biz_opaque_callback_data: row!.idempotencyKey },
      ]),
    );
    const [after] = await getDb().select().from(notifications).where(eq(notifications.id, n.id));
    expect(after!.status).toBe("SENT");
    expect(after!.providerMessageId).toBe("wamid.recovered");
    const audit = await getDb().select().from(auditLogs).where(eq(auditLogs.entityId, n.id));
    expect(audit.some((a) => a.action === "notification.reconciled")).toBe(true);
  });

  it("rejects an invalid signature", async () => {
    const res = await postWebhook(statusPayload([]), "sha256=" + "0".repeat(64));
    expect(res.status).toBe(401);
  });

  it("answers Meta's verification handshake only with the right token", async () => {
    const ok = await verifyWebhook(
      new (await import("next/server")).NextRequest(
        "http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345",
      ),
      { params: Promise.resolve({}) },
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");

    const bad = await call(verifyWebhook, {
      path: "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345",
    });
    expect(bad.status).toBe(403);
    const xss = await call(verifyWebhook, {
      path: "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=%3Cscript%3E",
    });
    expect(xss.status).toBe(403);
  });
});
