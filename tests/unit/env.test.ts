import { afterEach, describe, expect, it } from "vitest";
import { env, resetEnvCache } from "@/lib/configuration/env";

const BASE = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  AUTH_SECRET: "unit-test-auth-secret-0123456789abcdef",
};
const saved = { ...process.env };

function load(values: Record<string, string>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, BASE, values);
  resetEnvCache();
  return env();
}

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, saved);
  resetEnvCache();
});

describe("providers have no fake option", () => {
  it("offers SMTP or Brevo for e-mail, never mock", () => {
    expect(load({}).EMAIL_PROVIDER).toBe("smtp");
    expect(load({ EMAIL_PROVIDER: "brevo" }).EMAIL_PROVIDER).toBe("brevo");
    expect(() => load({ EMAIL_PROVIDER: "mock" })).toThrow(/EMAIL_PROVIDER/);
  });

  it("starts in production without any provider choice (unconfigured providers report it themselves)", () => {
    expect(() => load({ NODE_ENV: "production" })).not.toThrow();
  });
});

describe("admin login settings", () => {
  it("is off by default", () => {
    const config = load({});
    expect(config.ADMIN_USERNAME).toBeUndefined();
    expect(config.ADMIN_PASSWORD).toBeUndefined();
  });

  it("accepts a username and password together and lower-cases the username", () => {
    const config = load({ ADMIN_USERNAME: " Test.Admin ", ADMIN_PASSWORD: "eight-ch" });
    expect(config.ADMIN_USERNAME).toBe("test.admin");
    expect(config.ADMIN_PASSWORD).toBe("eight-ch");
  });

  it("requires both settings", () => {
    expect(() => load({ ADMIN_USERNAME: "test.admin" })).toThrow(/ADMIN_PASSWORD: .*set together/);
    expect(() => load({ ADMIN_PASSWORD: "long-enough-password" })).toThrow(/ADMIN_USERNAME: .*set together/);
  });

  it("rejects a short password and a username with unsafe characters", () => {
    expect(() => load({ ADMIN_USERNAME: "test.admin", ADMIN_PASSWORD: "short" })).toThrow(/ADMIN_PASSWORD/);
    expect(() => load({ ADMIN_USERNAME: "a@b.com", ADMIN_PASSWORD: "long-enough" })).toThrow(
      /ADMIN_USERNAME/,
    );
  });
});
