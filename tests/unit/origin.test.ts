import { describe, expect, it } from "vitest";
import { isAllowedRequestOrigin } from "@/lib/security/origin";

const APP = "https://leadpilot.example.com";

describe("isAllowedRequestOrigin (CSRF)", () => {
  it.each(["GET", "HEAD", "OPTIONS", "get"])("allows safe method %s without an Origin", (method) => {
    expect(isAllowedRequestOrigin(method, null, APP)).toBe(true);
  });

  it.each(["POST", "PATCH", "PUT", "DELETE"])("allows %s from the app's own origin", (method) => {
    expect(isAllowedRequestOrigin(method, APP, APP)).toBe(true);
  });

  it("ignores a trailing path on APP_BASE_URL", () => {
    expect(isAllowedRequestOrigin("POST", APP, `${APP}/some/path`)).toBe(true);
  });

  it("rejects a state-changing request with no Origin (fail closed)", () => {
    expect(isAllowedRequestOrigin("POST", null, APP)).toBe(false);
  });

  it("rejects the opaque 'null' origin", () => {
    expect(isAllowedRequestOrigin("POST", "null", APP)).toBe(false);
  });

  it.each([
    "https://evil.example.com",
    "http://leadpilot.example.com", // scheme downgrade
    "https://leadpilot.example.com:8443", // different port
    "https://leadpilot.example.com.evil.com", // suffix trick
    "not a url",
  ])("rejects foreign origin %s", (origin) => {
    expect(isAllowedRequestOrigin("POST", origin, APP)).toBe(false);
  });
});
