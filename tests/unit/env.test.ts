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

describe("mock providers in production", () => {
  it("refuses mock AI or e-mail in production", () => {
    expect(() => load({ NODE_ENV: "production", AI_PROVIDER: "openai", EMAIL_PROVIDER: "mock" })).toThrow(
      /EMAIL_PROVIDER: is 'mock' in production/,
    );
    expect(() => load({ NODE_ENV: "production", AI_PROVIDER: "mock", EMAIL_PROVIDER: "smtp" })).toThrow(
      /AI_PROVIDER: is 'mock' in production/,
    );
  });

  it("refuses the defaults in production, naming both settings", () => {
    expect(() => load({ NODE_ENV: "production" })).toThrow(/AI_PROVIDER.*EMAIL_PROVIDER/);
  });

  it("accepts mocks in production only with ALLOW_MOCK_PROVIDERS=true", () => {
    const config = load({ NODE_ENV: "production", ALLOW_MOCK_PROVIDERS: "true" });
    expect(config.AI_PROVIDER).toBe("mock");
    expect(config.EMAIL_PROVIDER).toBe("mock");
  });

  it("accepts real providers in production", () => {
    const config = load({ NODE_ENV: "production", AI_PROVIDER: "openai", EMAIL_PROVIDER: "smtp" });
    expect(config.AI_PROVIDER).toBe("openai");
  });

  it("keeps mocks as the default outside production", () => {
    expect(load({ NODE_ENV: "development" }).AI_PROVIDER).toBe("mock");
    expect(load({ NODE_ENV: "test" }).EMAIL_PROVIDER).toBe("mock");
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
