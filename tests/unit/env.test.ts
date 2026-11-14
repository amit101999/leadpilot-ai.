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
