import { describe, expect, it, vi } from "vitest";
import { buildLeadEmail, type LeadMessageInput } from "@/modules/notifications/message";
import { classifySmtpError, SmtpEmailProvider, type SmtpConfig } from "@/modules/notifications/smtp-email";
import { maskEmail } from "@/lib/security/sanitize";

const lead: LeadMessageInput = {
  title: `<script>alert(1)</script> Zoho "CRM" job`,
  budgetAmount: "800.00",
  budgetMax: null,
  currency: "USD",
  budgetType: "FIXED",
  paymentVerified: true,
  skills: ["Zoho CRM"],
  score: 88,
  reason: "Strong match & clear scope",
  riskFlags: [],
  jobUrl: "https://www.upwork.com/jobs/~01",
  dashboardUrl: "http://localhost:3001/jobs/1",
};

describe("lead e-mail", () => {
  it("escapes job-supplied text and links only http(s) URLs", () => {
    const { subject, html, text } = buildLeadEmail(lead, "STANDARD");
    expect(subject).toContain("88/100");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Strong match &amp; clear scope");
    expect(html).toContain('href="https://www.upwork.com/jobs/~01"');
    expect(text).toContain("Job URL: https://www.upwork.com/jobs/~01");

    const unsafe = buildLeadEmail({ ...lead, jobUrl: "javascript:alert(1)", dashboardUrl: null }, "STANDARD");
    expect(unsafe.html).not.toContain('href="javascript');
  });

  it("keeps the subject on one line", () => {
    expect(buildLeadEmail({ ...lead, title: "a\r\nBcc: x@evil.example" }, "STANDARD").subject).not.toMatch(
      /[\r\n]/,
    );
  });

  it("masks addresses for display", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("j•••@example.com");
    expect(maskEmail("broken")).toBe("•••");
  });
});

describe("SMTP outcome classification", () => {
  it("treats 5xx and authentication failures as permanent", () => {
    expect(classifySmtpError({ responseCode: 550, message: "mailbox unavailable" })).toMatchObject({
      kind: "rejected",
      retryable: false,
    });
    expect(classifySmtpError({ code: "EAUTH" })).toMatchObject({ kind: "rejected", retryable: false });
  });

  it("retries 4xx refusals and connections that never opened", () => {
    expect(classifySmtpError({ responseCode: 421 })).toMatchObject({ kind: "rejected", retryable: true });
    expect(classifySmtpError({ code: "ECONNECTION" })).toMatchObject({ kind: "rejected", retryable: true });
  });

  it("marks a connection lost mid-send as uncertain", () => {
    expect(classifySmtpError({ code: "ETIMEDOUT" }).kind).toBe("uncertain");
  });
});

describe("SmtpEmailProvider", () => {
  const config: SmtpConfig = {
    host: "smtp.example.com",
    port: 587,
    secure: false,
    user: "alerts@example.com",
    password: "app-password",
    from: "LeadPilot <alerts@example.com>",
    timeoutMs: 1000,
  };
  const message = { to: "me@example.com", subject: "s", text: "t", html: "<p>t</p>", idempotencyKey: "key1" };

  function provider(sendMail: (mail: unknown) => Promise<unknown>, cfg = config) {
    const createTransport = vi.fn(() => ({ sendMail, verify: vi.fn(async () => true) }));
    return { provider: new SmtpEmailProvider(cfg, createTransport as never), createTransport };
  }

  it("sends with the idempotency key as Message-ID and reports acceptance", async () => {
    const sendMail = vi.fn(async () => ({
      accepted: ["me@example.com"],
      messageId: "<key1@leadpilot.local>",
    }));
    const { provider: p } = provider(sendMail);
    expect(await p.send(message)).toEqual({
      kind: "accepted",
      providerMessageId: "<key1@leadpilot.local>",
      httpStatus: null,
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "<key1@leadpilot.local>", from: config.from }),
    );
  });

  it("refuses to send without configuration and never opens a connection", async () => {
    const { provider: p, createTransport } = provider(vi.fn(), { ...config, host: undefined });
    expect(await p.send(message)).toMatchObject({ kind: "rejected", retryable: false });
    expect(createTransport).not.toHaveBeenCalled();
    expect((await p.checkConnection()).missing).toEqual(["SMTP_HOST"]);
  });

  it("classifies a thrown SMTP error", async () => {
    const { provider: p } = provider(async () => {
      throw Object.assign(new Error("Greylisted"), { responseCode: 451 });
    });
    expect(await p.send(message)).toMatchObject({ kind: "rejected", retryable: true });
  });
});
