import { describe, expect, it } from "vitest";
import { centsToString, convertCents, formatMoney, toCents } from "@/lib/money/decimal";
import { escapeCsvCell, toCsv } from "@/lib/security/csv";
import { signPayload, verifyMetaSignature, verifySignature } from "@/lib/security/hmac";
import { maskPhone, sanitizeErrorMessage } from "@/lib/security/sanitize";
import { isSafeLinkHref, validateJobUrl } from "@/lib/security/url";
import { allowedFrom, assertTransition, canTransition } from "@/lib/state-machine";
import { NOTIFICATION_TRANSITIONS } from "@/modules/notifications/transitions";
import { RUN_JOB_TRANSITIONS, RUN_TRANSITIONS } from "@/modules/runs/transitions";
import { createHmac } from "node:crypto";

describe("money", () => {
  it("parses decimals exactly", () => {
    expect(toCents("500")).toBe(50000n);
    expect(toCents("499.99")).toBe(49999n);
    expect(toCents("0.1")).toBe(10n);
    expect(toCents(500)).toBe(50000n);
    for (const bad of ["-1", "1.234", "abc", "", "1e3"]) expect(toCents(bad)).toBeNull();
  });

  it("converts conservatively and formats", () => {
    expect(convertCents(46296n, "1.08")).toBe(49999n);
    expect(convertCents(100n, "0")).toBeNull();
    expect(centsToString(50004n)).toBe("500.04");
    expect(formatMoney("12500.00", "USD")).toBe("USD 12,500");
    expect(formatMoney(null, "USD")).toBe("Unknown");
  });
});

describe("state machines", () => {
  it("allows only declared run transitions", () => {
    expect(canTransition(RUN_TRANSITIONS, "QUEUED", "RUNNING")).toBe(true);
    expect(canTransition(RUN_TRANSITIONS, "COMPLETED", "RUNNING")).toBe(false);
    expect(() => assertTransition(RUN_TRANSITIONS, "FAILED", "COMPLETED", "run")).toThrow(/Invalid run/);
  });

  it("never lets a job leave a terminal filter state", () => {
    expect(RUN_JOB_TRANSITIONS.FILTERED_OUT).toEqual([]);
    expect(canTransition(RUN_JOB_TRANSITIONS, "AI_ERROR", "QUALIFIED")).toBe(false);
  });

  it("never auto-retries an uncertain notification into RESERVED", () => {
    expect(canTransition(NOTIFICATION_TRANSITIONS, "UNCERTAIN", "RESERVED")).toBe(false);
    expect(canTransition(NOTIFICATION_TRANSITIONS, "READ", "DELIVERED")).toBe(false);
    expect(allowedFrom(NOTIFICATION_TRANSITIONS, "SENDING").sort()).toEqual(
      ["FAILED_RETRYABLE", "RESERVED", "UNCERTAIN"].sort(),
    );
  });
});

describe("HMAC signing", () => {
  const secret = "s".repeat(40);
  it("verifies a fresh signature and rejects tampering, staleness and missing headers", () => {
    const header = signPayload(secret, '{"a":1}', 1_000_000);
    expect(verifySignature(secret, '{"a":1}', header, 1_000_010).ok).toBe(true);
    expect(verifySignature(secret, '{"a":2}', header, 1_000_010).ok).toBe(false);
    expect(verifySignature(secret, '{"a":1}', header, 1_000_000 + 301).ok).toBe(false);
    expect(verifySignature("other".repeat(10), '{"a":1}', header, 1_000_010).ok).toBe(false);
    expect(verifySignature(secret, "{}", null).ok).toBe(false);
    expect(verifySignature(secret, "{}", "garbage").ok).toBe(false);
  });

  it("verifies Meta webhook signatures", () => {
    const body = '{"entry":[]}';
    const sig = "sha256=" + createHmac("sha256", "appsecret").update(body).digest("hex");
    expect(verifyMetaSignature("appsecret", body, sig)).toBe(true);
    expect(verifyMetaSignature("appsecret", body + " ", sig)).toBe(false);
    expect(verifyMetaSignature("appsecret", body, null)).toBe(false);
  });
});

describe("CSV export", () => {
  it("neutralizes formula injection and quotes special characters", () => {
    expect(escapeCsvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(escapeCsvCell("+1")).toBe("'+1");
    expect(escapeCsvCell("@SUM")).toBe("'@SUM");
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell(null)).toBe("");
    expect(toCsv([{ a: 1 }], [{ header: "A", value: (r) => r.a }])).toBe("A\r\n1\r\n");
  });
});

describe("URL and sanitization", () => {
  it("only accepts https job URLs on the source's hosts", () => {
    expect(validateJobUrl("https://www.upwork.com/jobs/~01abc", "upwork").ok).toBe(true);
    expect(validateJobUrl("https://www.upwork.com.evil.test/jobs/1", "upwork").ok).toBe(false);
    expect(validateJobUrl("https://user:pw@www.upwork.com/jobs/1", "upwork").ok).toBe(false);
    expect(validateJobUrl("https://www.upwork.com/jobs/1", "unknown-source").ok).toBe(false);
    expect(isSafeLinkHref("javascript:alert(1)")).toBe(false);
  });

  it("redacts secrets and personal data from errors", () => {
    const text = sanitizeErrorMessage(
      new Error("401 Bearer abc.def.ghi for user@example.com phone +15551234567 key sk-abcdefghijklmnop"),
    );
    expect(text).not.toMatch(/abc\.def|user@example|5551234567|sk-abcdef/);
    expect(maskPhone("+15551234567")).toBe("+1•••••••567");
  });
});
