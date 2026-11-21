import { describe, expect, it, vi } from "vitest";
import {
  BrevoEmailProvider,
  classifyBrevoNetworkError,
  classifyBrevoResponse,
  parseSender,
} from "@/modules/notifications/brevo-email";

const message = {
  to: "jane@example.com",
  subject: "New lead",
  text: "Hello",
  html: "<p>Hello</p>",
  idempotencyKey: "notif-123",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Brevo sender parsing", () => {
  it("accepts a bare address or a named address", () => {
    expect(parseSender("alerts@example.com")).toEqual({ email: "alerts@example.com" });
    expect(parseSender("LeadPilot <alerts@example.com>")).toEqual({
      email: "alerts@example.com",
      name: "LeadPilot",
    });
    expect(parseSender('"Lead Pilot" <alerts@example.com>')).toEqual({
      email: "alerts@example.com",
      name: "Lead Pilot",
    });
  });

  it("rejects anything that is not one address", () => {
    expect(parseSender("not an address")).toBeNull();
    expect(parseSender("a@b.c, d@e.f")).toBeNull();
  });
});

describe("Brevo outcome classification", () => {
  it("accepts 2xx with Brevo's message id", () => {
    expect(classifyBrevoResponse(201, { messageId: "<abc@smtp-relay>" })).toEqual({
      kind: "accepted",
      providerMessageId: "<abc@smtp-relay>",
      httpStatus: 201,
    });
  });

  it("treats 4xx as permanent and 429/5xx as retryable", () => {
    expect(classifyBrevoResponse(400, { message: "invalid sender" })).toMatchObject({
      kind: "rejected",
      retryable: false,
      httpStatus: 400,
    });
    expect(classifyBrevoResponse(401, null)).toMatchObject({ kind: "rejected", retryable: false });
    expect(classifyBrevoResponse(429, null)).toMatchObject({ kind: "rejected", retryable: true });
    expect(classifyBrevoResponse(503, null)).toMatchObject({ kind: "rejected", retryable: true });
  });

  it("treats a gateway error (502/504) as uncertain: Brevo may have taken the message", () => {
    expect(classifyBrevoResponse(502, null).kind).toBe("uncertain");
    expect(classifyBrevoResponse(504, null).kind).toBe("uncertain");
  });

  it("gives each accepted message without a Brevo id its own id (the column is unique)", () => {
    const a = classifyBrevoResponse(201, {});
    const b = classifyBrevoResponse(201, {});
    expect(
      a.kind === "accepted" && b.kind === "accepted" && a.providerMessageId !== b.providerMessageId,
    ).toBe(true);
  });

  it("retries only requests that never left; anything else is uncertain", () => {
    expect(classifyBrevoNetworkError({ cause: { code: "ENOTFOUND" } })).toMatchObject({
      kind: "rejected",
      retryable: true,
    });
    expect(classifyBrevoNetworkError({ name: "TimeoutError" })).toMatchObject({ kind: "uncertain" });
  });
});

describe("BrevoEmailProvider", () => {
  it("sends one JSON request with the API key header and parsed sender", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { messageId: "m-1" }));
    const provider = new BrevoEmailProvider(
      { apiKey: "test-key", from: "LeadPilot <alerts@example.com>", timeoutMs: 5000 },
      fetchImpl,
    );
    const outcome = await provider.send(message);

    expect(outcome).toMatchObject({ kind: "accepted", providerMessageId: "m-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("test-key");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      sender: { email: "alerts@example.com", name: "LeadPilot" },
      to: [{ email: "jane@example.com" }],
      subject: "New lead",
      htmlContent: "<p>Hello</p>",
      textContent: "Hello",
    });
  });

  it("refuses without calling Brevo when settings are missing", async () => {
    const fetchImpl = vi.fn();
    const provider = new BrevoEmailProvider({ timeoutMs: 5000 }, fetchImpl);
    expect(await provider.send(message)).toMatchObject({ kind: "rejected", retryable: false });
    expect(await provider.checkConnection()).toMatchObject({
      state: "NOT_CONFIGURED",
      missing: ["BREVO_API_KEY", "EMAIL_FROM"],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("checks the API key against the account endpoint", async () => {
    const ok = new BrevoEmailProvider(
      { apiKey: "k", from: "a@example.com", timeoutMs: 5000 },
      vi.fn().mockResolvedValue(jsonResponse(200, {})),
    );
    expect(await ok.checkConnection()).toMatchObject({ state: "CONNECTED" });
    const bad = new BrevoEmailProvider(
      { apiKey: "k", from: "a@example.com", timeoutMs: 5000 },
      vi.fn().mockResolvedValue(jsonResponse(401, {})),
    );
    expect(await bad.checkConnection()).toMatchObject({ state: "NOT_AUTHORIZED" });
  });
});
