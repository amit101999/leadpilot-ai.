import { describe, expect, it } from "vitest";
import { resolveLeadPilotUrl } from "../../scripts/lib/leadpilot-url.mjs";

describe("resolveLeadPilotUrl", () => {
  it("defaults to the local development server", () => {
    expect(resolveLeadPilotUrl(undefined)).toBe("http://localhost:3000");
  });

  it("accepts https and strips trailing slashes", () => {
    expect(resolveLeadPilotUrl("https://leads.example.com/")).toBe("https://leads.example.com");
    expect(resolveLeadPilotUrl(" https://example.com/leadpilot// ")).toBe("https://example.com/leadpilot");
  });

  it("allows plain http only for loopback hosts", () => {
    expect(resolveLeadPilotUrl("http://127.0.0.1:3001")).toBe("http://127.0.0.1:3001");
    expect(resolveLeadPilotUrl("http://[::1]:3001")).toBe("http://[::1]:3001");
    expect(() => resolveLeadPilotUrl("http://leads.example.com")).toThrow(/https/);
    expect(() => resolveLeadPilotUrl("http://localhost.evil.com")).toThrow(/https/);
  });

  it("rejects other schemes, embedded credentials and invalid values", () => {
    expect(() => resolveLeadPilotUrl("ftp://leads.example.com")).toThrow(/https/);
    expect(() => resolveLeadPilotUrl("https://user:pass@leads.example.com")).toThrow(/credentials/);
    expect(() => resolveLeadPilotUrl("not a url")).toThrow(/valid URL/);
  });
});
