import { describe, expect, it, vi } from "vitest";
import { CloudWhatsAppProvider, type CloudWhatsAppConfig } from "@/modules/notifications/cloud-whatsapp";
import type { OutboundMessage } from "@/modules/notifications/provider";

const TOKEN = "EAAG-secret-token";

const config: CloudWhatsAppConfig = {
  accessToken: TOKEN,
  phoneNumberId: "1234567890",
  graphApiVersion: "v21.0",
  language: "en_US",
  templates: { lead: "lead_alert", summary: "run_summary", test: "hello_world" },
  timeoutMs: 1000,
};

const message: OutboundMessage = {
  to: "+14155550123",
  kind: "lead",
  templateParams: ["Title", "USD 800"],
  previewText: "preview",
  idempotencyKey: "key-1",
  callbackData: "notification:abc",
};

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

function failWith(error: Error) {
  return vi.fn(async () => {
    throw error;
  });
}

describe("CloudWhatsAppProvider.send", () => {
  it("posts an approved template to the Graph API and returns the message id", async () => {
    const fetchMock = respond(200, { messages: [{ id: "wamid.1" }] });
    const outcome = await new CloudWhatsAppProvider(config, fetchMock).send(message);

    expect(outcome).toEqual({ kind: "accepted", providerMessageId: "wamid.1", httpStatus: 200 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/1234567890/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      to: "14155550123",
      type: "template",
      template: { name: "lead_alert", language: { code: "en_US" } },
      biz_opaque_callback_data: "notification:abc",
    });
    expect(body.template.components[0].parameters).toEqual([
      { type: "text", text: "Title" },
      { type: "text", text: "USD 800" },
    ]);
  });

  it("treats a 2xx response without a message id as uncertain", async () => {
    const outcome = await new CloudWhatsAppProvider(config, respond(200, {})).send(message);
    expect(outcome.kind).toBe("uncertain");
  });

  it("classifies API errors: 4xx is final, 429 and 5xx may be retried", async () => {
    const send = (status: number) =>
      new CloudWhatsAppProvider(config, respond(status, { error: { code: 131026 } })).send(message);
    expect(await send(400)).toMatchObject({ kind: "rejected", retryable: false, httpStatus: 400 });
    expect(await send(429)).toMatchObject({ kind: "rejected", retryable: true });
    expect(await send(503)).toMatchObject({ kind: "rejected", retryable: true });
    expect(((await send(400)) as { error: string }).error).toContain("code 131026");
  });

  it("marks a timeout as uncertain, because the message may have been sent", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const outcome = await new CloudWhatsAppProvider(config, failWith(timeout)).send(message);
    expect(outcome.kind).toBe("uncertain");
  });

  it("marks a connection refused before sending as safely retryable", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const outcome = await new CloudWhatsAppProvider(config, failWith(refused)).send(message);
    expect(outcome).toMatchObject({ kind: "rejected", retryable: true });
  });

  it("refuses to send without configuration and never calls the API", async () => {
    const fetchMock = respond(200, {});
    const outcome = await new CloudWhatsAppProvider({ ...config, accessToken: undefined }, fetchMock).send(
      message,
    );
    expect(outcome).toMatchObject({ kind: "rejected", retryable: false });
    expect((outcome as { error: string }).error).toContain("WHATSAPP_ACCESS_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("CloudWhatsAppProvider.checkConnection", () => {
  it("reports accepted, rejected and unreachable credentials without echoing the token", async () => {
    const check = (fetchMock: typeof fetch) => new CloudWhatsAppProvider(config, fetchMock).checkConnection();
    expect((await check(respond(200, {}))).state).toBe("CONNECTED");
    const rejected = await check(respond(401, {}));
    expect(rejected.state).toBe("NOT_AUTHORIZED");
    expect(rejected.message).not.toContain(TOKEN);
    expect((await check(failWith(new TypeError("fetch failed")))).state).toBe("UNAVAILABLE");
  });

  it("lists missing settings by name only", async () => {
    const result = await new CloudWhatsAppProvider({ ...config, phoneNumberId: undefined }).checkConnection();
    expect(result).toMatchObject({ state: "NOT_CONFIGURED", missing: ["WHATSAPP_PHONE_NUMBER_ID"] });
  });
});
