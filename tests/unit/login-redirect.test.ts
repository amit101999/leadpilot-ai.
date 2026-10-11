import { describe, expect, it } from "vitest";
import { loginRedirectTarget, safeNextPath } from "@/lib/auth/login-redirect";

describe("loginRedirectTarget", () => {
  it("lets requests with a session cookie through", () => {
    expect(loginRedirectTarget("/dashboard", "", true)).toBeNull();
  });

  it("never redirects the login page itself (no loop)", () => {
    expect(loginRedirectTarget("/login", "?next=%2Fruns", false)).toBeNull();
  });

  it("redirects a protected page and preserves path and query in ?next", () => {
    expect(loginRedirectTarget("/history", "?status=FAILED", false)).toBe(
      `/login?next=${encodeURIComponent("/history?status=FAILED")}`,
    );
  });

  it("omits ?next for the root path", () => {
    expect(loginRedirectTarget("/", "", false)).toBe("/login");
  });
});

describe("safeNextPath (open-redirect protection)", () => {
  it.each(["/dashboard", "/runs/123?tab=jobs"])("accepts relative path %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    null,
    "",
    "https://evil.example.com",
    "//evil.example.com",
    "/\\evil.example.com",
    "dashboard",
    "/ok\nSet-Cookie: x=1",
    `/${"a".repeat(2048)}`,
  ])("rejects %j", (value) => {
    expect(safeNextPath(value)).toBeNull();
  });
});
